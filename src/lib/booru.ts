import {container} from '@sapphire/framework';
import {redis} from './redis';
import booru, {BooruClass, BooruCredentials, sites} from "booru";
import {ICache, RedisCache} from "./cache";

export interface IBooruService {
    getRandom(tags: string[]): Promise<BooruPost | null>;

    validateTags(tags: string[]): Promise<boolean>;

    isNSFW(): boolean;

    readonly siteDomain: string;

    getPostCount(tags: string[]): Promise<number>;
}

interface IBooruApi {
    fetchFromAPI(tags: string[], page?: number): Promise<BooruPost[]>;
}

export interface BooruPost {
    id: string;
    fileUrl: string;
    sampleUrl: string;
    source: string;
    rating: string;
    tags: string[];
    score: number;
    postView: string;
}

export const BOORU_CHOICES = Object.values(sites)
    .filter(s => s.api.postCount !== undefined)
    .map(site => ({
        name: `${site.domain} ${site.nsfw ? '🔴 (NSFW)' : '🟢 (SFW)'}`,
        value: site.domain
    }))
    .slice(0, 25);

export class BooruServiceFactory {
    private static serviceCache = new Map<string, IBooruService>();

    public static getService(site: string): IBooruService {
        const targetSite = site;

        if (this.serviceCache.has(targetSite)) {
            return this.serviceCache.get(targetSite)!;
        }

        console.log(targetSite);

        const rawClient = booru(targetSite, this.createCredentialsForSite(targetSite));
        const core = new BooruServiceImpl(rawClient);
        const cached = new CachedBooruService(
            core,
            new RedisCache<BooruPost[]>(redis),
            new RedisCache<number>(redis)
        );

        this.serviceCache.set(targetSite, cached);
        container.logger.info(`[BooruServiceFactory] Created new BooruService for site: ${targetSite}`);
        return cached;
    }

    private static createCredentialsForSite(site: string): BooruCredentials {
        if (site === 'gelbooru.com') {
            container.logger.info(`[BooruServiceFactory] Creating credentials for : ${site}`);
            return {
                user_id: process.env.GELBOORU_USER_ID || '',
                api_key: process.env.GELBOORU_API_KEY || '',
            };
        }
        if (site === 'api.rule34.xxx') {
            container.logger.info(`[BooruServiceFactory] Creating credentials for : ${site}`);
            return {
                user_id: process.env.RULE34_USER_ID || '',
                api_key: process.env.RULE34_API_KEY || '',
            };
        }
        return {};
    }

}

const POST_LIMIT = 100;

class BooruServiceImpl implements IBooruService, IBooruApi {

    constructor(private readonly client: BooruClass) {
    }

    public get siteDomain(): string {
        return this.client.domain;
    }

    public isNSFW(): boolean {
        return this.client.site.nsfw;
    }

    public async getRandom(tags: string[]): Promise<BooruPost | null> {
        const posts = await this.fetchFromAPI(tags);
        if (posts.length === 0) return null;
        return this.random(posts);
    }

    public async getPostCount(tags: string[]): Promise<number> {
        return this.client.getPostCount(tags);
    }

    public async validateTags(tags: string[]): Promise<boolean> {
        const count = await this.getPostCount(tags);
        return count > 0;
    }

    public async fetchFromAPI(tags: string[], page?: number): Promise<BooruPost[]> {
        container.logger.debug(`[${this.siteDomain}] API Request: tags=[${tags.join(', ')}], page=${page || 0}`);

        const results = await this.client.search(tags, {limit: POST_LIMIT, random: false, page});

        const validPosts: BooruPost[] = [];

        for (const p of results) {
            if (typeof p.fileUrl === "string" && p.fileUrl.length > 0) {
                validPosts.push({
                    id: String(p.id),
                    fileUrl: p.fileUrl,
                    sampleUrl: p.sampleUrl ?? '',
                    source: Array.isArray(p.source) ? p.source.join(', ') : p.source ?? 'Unknown',
                    rating: p.rating,
                    tags: p.tags,
                    score: p.score ?? 0,
                    postView: p.postView,
                });
            }
        }
        return validPosts;
    }

    private random(posts: BooruPost[]): BooruPost {
        return posts[Math.floor(Math.random() * posts.length)];
    }
}

const TTL_POST_COUNT = 60 * 60 * 24;
const TTL_POST = 60 * 10;

class CachedBooruService implements IBooruService {

    constructor(
        private readonly inner: IBooruService & IBooruApi,
        private readonly postCache: ICache<BooruPost[]>,
        private readonly countCache: ICache<number>
    ) {
    }

    get siteDomain(): string {
        return this.inner.siteDomain;
    }

    isNSFW(): boolean {
        return this.inner.isNSFW();
    }

    async getRandom(tags: string[]): Promise<BooruPost | null> {
        const key = this.buildKey("posts", tags);

        const cached = await this.postCache.get(key);
        if (cached?.length) {
            container.logger.debug(`[${this.siteDomain}] Image Cache HIT: ${key}`);
            return this.random(cached);
        }

        container.logger.info(`[${this.siteDomain}] Image Cache MISS: Calculating new random page...`);

        const totalPosts = await this.getPostCount(tags);
        if (totalPosts === 0) {
            container.logger.warn(`[${this.siteDomain}] No posts found for tags: ${tags.join(', ')}`);
            return null;
        }

        // some apis won't let you paginate to page 1000 or above, failsafe
        const maxPages = Math.min(Math.ceil(totalPosts / POST_LIMIT), 499);
        const randomPage = Math.floor(Math.random() * maxPages);

        container.logger.debug(`[${this.siteDomain}] Smart Random: Selected page ${randomPage} of ${maxPages}`)

        const posts = await this.inner.fetchFromAPI(tags, randomPage);

        if (posts?.length > 0) {
            await this.postCache.set(key, posts, TTL_POST);
            container.logger.debug(`[${this.siteDomain}] Successfully cached ${posts.length} images for ${TTL_POST}s`)
            return this.random(posts);
        }

        return null;
    }

    async getPostCount(tags: string[]): Promise<number> {
        const key = this.buildKey("count", tags);

        const cached = await this.countCache.get(key);
        if (cached !== null) {
            container.logger.debug(`[${this.siteDomain}] Count Cache HIT: ${cached} posts`);
            return cached;
        }

        container.logger.info(`[${this.siteDomain}] Count Cache MISS: Fetching total count...`);

        const count = await this.inner.getPostCount(tags);
        await this.countCache.set(key, count, TTL_POST_COUNT);

        return count;
    }

    async validateTags(tags: string[]): Promise<boolean> {
        return (await this.getPostCount(tags)) > 0;
    }

    private buildKey(type: string, tags: string[]): string {
        const normalized = tags
            .map(t => t.toLowerCase().trim())
            .filter(Boolean)
            .sort()
            .join('_');

        return `booru:${type}:${this.siteDomain}:${normalized || "random"}`;
    }

    private random(posts: BooruPost[]): BooruPost {
        return posts[Math.floor(Math.random() * posts.length)];
    }

}

import {Redis} from "ioredis";
import {container} from "@sapphire/framework";

export interface ICache<T> {
    get(key: string): Promise<T | null>;

    set(key: string, value: T, ttlSeconds?: number): Promise<void>;

    delete(key: string): Promise<void>;
}

export class RedisCache<T> implements ICache<T> {
    constructor(private readonly redis: Redis) {
    }

    async get(key: string): Promise<T | null> {
        const data = await this.redis.get(key);
        if (!data) return null;
        try {
            return JSON.parse(data) as T;
        } catch (e) {
            container.logger.error(`[RedisCache] Failed to parse JSON for key ${key}`, e);
            return null;
        }
    }

    async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const serialized = JSON.stringify(value);

        if (ttlSeconds) {
            await this.redis.set(key, serialized, "EX", ttlSeconds);
        } else {
            await this.redis.set(key, serialized);
        }
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(key);
    }


}
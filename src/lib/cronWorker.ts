import {Worker, Job} from 'bullmq';
import {container} from '@sapphire/framework';
import {DiscordService} from './discordService';
import {CronService} from "./cronService";
import {BooruServiceFactory} from "./booru";

export interface CronjobPayload {
    channelId: string;
    tags: string[];
    cronjobId: string;
    message?: string;
    site: string;
}

let worker: Worker | null = null;

export function startCronWorker(): void {
    worker = new Worker<CronjobPayload>(
        'cronjobs',
        async (job: Job<CronjobPayload>) => {
            await processCronjob(job.data);
        },
        {
            connection: container.redisConfig,
            concurrency: 5,
        }
    );

    worker.on('completed', (job) => {
        container.logger.debug(`[CronWorker] Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        container.logger.error(`[CronWorker] Job ${job?.id} failed:`, err);
    });

    container.logger.info('[CronWorker] Worker started successfully');
}

async function processCronjob(payload: CronjobPayload): Promise<void> {
    const {channelId, tags, cronjobId, message, site} = payload;

    const booruService = BooruServiceFactory.getService(site);
    try {
        container.logger.info(`[CronWorker] Starting Job ${cronjobId} on site ${site || 'default'}`);
        const post = await booruService.getRandom(tags);

        if (!post) {
            container.logger.warn(`[CronWorker] No posts found for cronjob ${cronjobId} with tags: ${tags.join(', ')}`);

            const noResultsEmbed = DiscordService.createNoResultsEmbed(tags);
            await DiscordService.sendToChannel(channelId, {
                embeds: [noResultsEmbed.toJSON()],
            });
            return;
        }

        const embed = DiscordService.createRule34Embed(post, tags);

        const result = await DiscordService.sendToChannel(channelId, {
            content: message,
            embeds: [embed.toJSON()],
        });

        if (result.success) {
            container.logger.info(`[CronWorker] Successfully sent post to channel ${channelId} (Job: ${cronjobId})`);
        } else {
            container.logger.warn(`[CronWorker] Failed to send to channel ${channelId}: ${result.error}`);

            if (result.error?.includes('not found') || result.error?.includes('Unknown Channel')) {
                await deactivateCronjob(cronjobId);
            }
        }

    } catch (error) {
        container.logger.error(`[CronWorker] Error processing cronjob ${cronjobId}:`, error);
    }
}

async function deactivateCronjob(cronjobId: string): Promise<void> {
    try {
        await container.prisma.cronjob.update({
            where: {id: cronjobId},
            data: {isActive: false},
        });

        await CronService.delete(cronjobId);
        container.logger.info(`[CronWorker] Deactivated cronjob ${cronjobId} due to missing channel`);
    } catch (error) {
        container.logger.error(`[CronWorker] Failed to deactivate cronjob ${cronjobId}:`, error);
    }
}

export async function stopCronWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
        container.logger.info('[CronWorker] Worker stopped');
    }
}




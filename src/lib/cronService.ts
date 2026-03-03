import {container} from '@sapphire/framework';
import type {Cronjob} from '@prisma/client';
import type {CronjobPayload} from './cronWorker';

export interface CronjobUpdateData {
    channelId?: string;
    cronExpression?: string;
    timezone?: string;
    tags?: string[];
    message?: string;
    name?: string | null;
    isActive?: boolean;
    booruSite?: string;
}

export interface CronjobCreateData {
    guildId: string;
    channelId: string;
    cronExpression: string;
    timezone?: string;
    tags: string[];
    message?: string;
    name?: string;
    site?: string;
}

export class CronService {
    static async create(data: CronjobCreateData): Promise<Cronjob> {
        const cronjob = await container.prisma.cronjob.create({
            data: {
                guildId: data.guildId,
                channelId: data.channelId,
                cronExpression: data.cronExpression,
                timezone: data.timezone || 'UTC',
                tags: data.tags,
                message: data.message || '',
                name: data.name,
                isActive: true,
                booruSite: data.site || 'safebooru',
            },
        });

        await this.scheduleInRedis(cronjob);

        container.logger.info(`[CronService] Created cronjob ${cronjob.id} for guild ${data.guildId}`);
        return cronjob;
    }

    static async update(cronjobId: string, data: CronjobUpdateData): Promise<Cronjob> {
        const currentCronjob = await container.prisma.cronjob.findUnique({
            where: {id: cronjobId},
        });

        if (!currentCronjob) {
            throw new Error('Cronjob not found');
        }

        const needsReschedule =
            data.cronExpression !== undefined && data.cronExpression !== currentCronjob.cronExpression ||
            data.timezone !== undefined && data.timezone !== currentCronjob.timezone;

        const needsPayloadUpdate =
            data.channelId !== undefined && data.channelId !== currentCronjob.channelId ||
            data.tags !== undefined ||
            data.message !== undefined && data.message !== currentCronjob.message ||
            data.name !== undefined && data.name !== currentCronjob.name ||
            data.booruSite !== undefined && data.booruSite !== currentCronjob.booruSite;

        const activeStatusChanged = data.isActive !== undefined && data.isActive !== currentCronjob.isActive;

        const updatedCronjob = await container.prisma.cronjob.update({
            where: {id: cronjobId},
            data,
        });

        if (activeStatusChanged) {
            if (updatedCronjob.isActive) {
                await this.scheduleInRedis(updatedCronjob);
            } else {
                await this.removeFromRedis(cronjobId);
            }
        } else if (updatedCronjob.isActive && (needsReschedule || needsPayloadUpdate)) {
            await this.removeFromRedis(cronjobId);
            await this.scheduleInRedis(updatedCronjob);
        }

        container.logger.info(`[CronService] Updated cronjob ${cronjobId}`);
        return updatedCronjob;
    }

    static async delete(cronjobId: string): Promise<void> {
        await this.removeFromRedis(cronjobId);

        await container.prisma.cronjob.delete({
            where: {id: cronjobId},
        });

        container.logger.info(`[CronService] Deleted cronjob ${cronjobId}`);
    }

    static async toggle(cronjobId: string): Promise<Cronjob> {
        const cronjob = await container.prisma.cronjob.findUnique({
            where: {id: cronjobId},
        });

        if (!cronjob) {
            throw new Error('Cronjob not found');
        }

        return this.update(cronjobId, {isActive: !cronjob.isActive});
    }

    static async getByGuild(guildId: string, activeOnly = true): Promise<Cronjob[]> {
        return container.prisma.cronjob.findMany({
            where: {
                guildId,
                ...(activeOnly ? {isActive: true} : {}),
            },
            orderBy: {createdAt: 'desc'},
        });
    }

    static async getByIdAndGuild(cronjobId: string, guildId: string): Promise<Cronjob | null> {
        return container.prisma.cronjob.findFirst({
            where: {
                id: cronjobId,
                guildId,
            },
        });
    }

    static async countByGuild(guildId: string): Promise<number> {
        return container.prisma.cronjob.count({
            where: {guildId, isActive: true},
        });
    }

    private static async scheduleInRedis(cronjob: Cronjob): Promise<void> {
        const payload: CronjobPayload = {
            channelId: cronjob.channelId,
            tags: cronjob.tags,
            cronjobId: cronjob.id,
            message: cronjob.message || undefined,
            site: cronjob.booruSite,
        };

        await this.removeFromRedis(cronjob.id);

        await container.cronQueue.upsertJobScheduler(
            cronjob.id,
            {
                pattern: cronjob.cronExpression,
                tz: cronjob.timezone,
            },
            {
                name: 'send-message',
                data: payload,
            }
        );

        container.logger.debug(`[CronService] Scheduled cronjob ${cronjob.id} in Redis`);
    }

    private static async removeFromRedis(cronjobId: string): Promise<void> {
        try {
            await container.cronQueue.removeJobScheduler(cronjobId);
            container.logger.debug(` Removed Redis scheduler: ${cronjobId}`);
        } catch (error) {
            container.logger.warn(` Failed to remove cronjob ${cronjobId} from Redis:`, error);
        }
    }

    static async getRedisJobInfo(cronjobId: string): Promise<{ exists: boolean; nextRun?: Date }> {
        try {
            const schedulers = await container.cronQueue.getJobSchedulers();
            const job = schedulers.find(j => j.key === cronjobId);

            if (job) {
                return {
                    exists: true,
                    nextRun: job.next ? new Date(job.next) : undefined,
                };
            }
        } catch (error) {
            container.logger.warn(` Failed to get Redis info for ${cronjobId}:`, error);
        }

        return {exists: false};
    }


    static async syncAll(): Promise<{ synced: number; removed: number; errors: number }> {
        let synced = 0;
        let removed = 0;
        let errors = 0;

        try {
            const activeCronjobs = await container.prisma.cronjob.findMany({
                where: {isActive: true},
            });

            const existingRepeatableJobs = await container.cronQueue.getJobSchedulers();
            const existingJobIds = new Set(existingRepeatableJobs.map(job => job.key));
            const dbJobIds = new Set(activeCronjobs.map(job => job.id));

            for (const cronjob of activeCronjobs) {
                if (!existingJobIds.has(cronjob.id)) {
                    try {
                        await this.scheduleInRedis(cronjob);
                        synced++;
                    } catch (error) {
                        errors++;
                        container.logger.error(`[CronService] Failed to sync cronjob ${cronjob.id}:`, error);

                        if (error instanceof Error && error.message.includes('Invalid')) {
                            await container.prisma.cronjob.update({
                                where: {id: cronjob.id},
                                data: {isActive: false},
                            });
                        }
                    }
                }
            }

            for (const redisJob of existingRepeatableJobs) {
                if (redisJob.key && !dbJobIds.has(redisJob.key)) {
                    try {
                        await container.cronQueue.removeJobScheduler(redisJob.key);
                        removed++;
                    } catch (error) {
                        errors++;
                    }
                }
            }
        } catch (error) {
            container.logger.error('[CronService] Critical sync error:', error);
            throw error;
        }

        return {synced, removed, errors};
    }
}


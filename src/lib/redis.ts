import { Redis } from 'ioredis';
import { container } from '@sapphire/framework';

export const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

export const redis = new Redis(redisConfig);

container.redis = redis;

declare module '@sapphire/pieces' {
    interface Container {
        redis: Redis;
    }
}
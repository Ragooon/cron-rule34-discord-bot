import 'dotenv/config';

import {SapphireClient, container, LogLevel, RegisterBehavior, ApplicationCommandRegistries} from '@sapphire/framework';

ApplicationCommandRegistries.setDefaultGuildIds(['430980608257294336']);

import { GatewayIntentBits } from 'discord.js';
import { Queue } from 'bullmq';

import { prisma } from './lib/prisma';
import {redisConfig} from "./lib/redis";

declare module '@sapphire/pieces' {
    interface Container {
        cronQueue: Queue;
        redisConfig: typeof redisConfig;
    }
}

container.redisConfig = redisConfig;

const cronQueue = new Queue('cronjobs', {
    connection: redisConfig,
});

container.cronQueue = cronQueue;

const client = new SapphireClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    baseUserDirectory: __dirname,
    logger: {
        level: LogLevel.Debug
    }
});

async function main(): Promise<void> {
    try {
        client.logger.info('Starting bot...');

        client.logger.info('Warming up database connection...');
        await prisma.$connect();
        client.logger.info('Database connected!');

        await client.login(process.env.DISCORD_TOKEN);

        client.logger.info('Bot successfully logged in!');
    } catch (error) {
        client.logger.fatal('Failed to start the bot:', error);
        await client.destroy();
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    client.logger.info('Received SIGINT, shutting down gracefully...');
    await cronQueue.close();
    await prisma.$disconnect();
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    client.logger.info('Received SIGTERM, shutting down gracefully...');
    await cronQueue.close();
    await client.destroy();
    process.exit(0);
});

main();




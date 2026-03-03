import { Listener } from '@sapphire/framework';
import { Client } from 'discord.js';
import { startCronWorker } from '../lib/cronWorker';
import { CronService } from '../lib/cronService';

export class ReadyListener extends Listener {
    public constructor(context: Listener.LoaderContext, options: Listener.Options) {
        super(context, {
            ...options,
            once: true,
            event: 'ready',
        });
    }

    public async run(client: Client<true>): Promise<void> {
        this.container.logger.info(`[Ready] Logged in as ${client.user.tag}`);
        this.container.logger.info(`[Ready] Serving ${client.guilds.cache.size} guilds`);

        await this.synchronizeCronjobs();

        startCronWorker();
    }

    private async synchronizeCronjobs(): Promise<void> {
        this.container.logger.info('[Sync] Starting cronjob synchronization...');

        try {
            const result = await CronService.syncAll();
            this.container.logger.info(
                `[Sync] Synchronization complete. Synced: ${result.synced}, Removed: ${result.removed}, Errors: ${result.errors}`
            );
        } catch (error) {
            this.container.logger.error('[Sync] Critical error during synchronization:', error);
        }
    }
}


import { Command } from '@sapphire/framework';
import {
    PermissionFlagsBits,
    EmbedBuilder,
    time,
    TimestampStyles,
    MessageFlags,
    InteractionContextType
} from 'discord.js';
import { CronService } from '../lib/cronService';

export class ListCronCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: 'list-crons',
            description: 'List all Rule34 cronjobs for this server',
        });
    }

    public override registerApplicationCommands(registry: Command.Registry): void {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName(this.name)
                .setDescription(this.description)
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .setContexts(InteractionContextType.Guild)
                .addBooleanOption((option) =>
                    option
                        .setName('show-inactive')
                        .setDescription('Also show inactive/disabled cronjobs')
                        .setRequired(false)
                ),
            { idHints: [] }
        );
    }

    public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId!;
        const showInactive = interaction.options.getBoolean('show-inactive') || false;

        try {
            const cronjobs = await CronService.getByGuild(guildId, !showInactive);

            if (cronjobs.length === 0) {
                await interaction.editReply({
                    content: showInactive
                        ? '📭 No cronjobs found for this server.\n\nUse `/create-cron` to create one!'
                        : '📭 No active cronjobs found for this server.\n\nUse `/create-cron` to create one, or use `/list-crons show-inactive:True` to see disabled ones.',
                });
                return;
            }

            const activeCount = cronjobs.filter(j => j.isActive).length;
            const inactiveCount = cronjobs.length - activeCount;

            const embed = new EmbedBuilder()
                .setTitle('📅 Scheduled Messages')
                .setDescription(
                    `Found **${cronjobs.length}** cronjob(s)\n` +
                    `✅ Active: **${activeCount}** | ❌ Inactive: **${inactiveCount}**`
                )
                .setColor(0x5865F2)
                .setTimestamp();

            for (const job of cronjobs.slice(0, 10)) {
                const channel = await this.container.client.channels.fetch(job.channelId).catch(() => null);
                const channelMention = channel ? `<#${job.channelId}>` : `Unknown (${job.channelId})`;
                const status = job.isActive ? '✅' : '❌';

                // Get next run time from Redis
                const redisInfo = job.isActive ? await CronService.getRedisJobInfo(job.id) : { exists: false };
                const nextRunText = redisInfo.nextRun
                    ? `**Next:** <t:${Math.floor(redisInfo.nextRun.getTime() / 1000)}:R>`
                    : '';

                const title = job.name
                    ? `${status} ${job.name}`
                    : `${status} \`${job.id.substring(0, 8)}...\``;

                const tagsDisplay = job.tags.length > 5
                    ? job.tags.slice(0, 5).join(', ') + ` (+${job.tags.length - 5} more)`
                    : job.tags.join(', ');

                embed.addFields({
                    name: title,
                    value: [
                        `**ID:** \`${job.id.substring(0, 8)}...\``,
                        `**Pattern:** \`${job.cronExpression}\` (${job.timezone})`,
                        `**Channel:** ${channelMention}`,
                        `**Tags:** ${tagsDisplay || 'None'}`,
                        job.message ? `**Message:** ${job.message.length > 50 ? job.message.substring(0, 50) + '...' : job.message}` : '',
                        nextRunText,
                        `**Created:** ${time(job.createdAt, TimestampStyles.RelativeTime)}`,
                    ].filter(Boolean).join('\n'),
                    inline: false,
                });
            }

            if (cronjobs.length > 10) {
                embed.setFooter({ text: `Showing 10 of ${cronjobs.length} cronjobs` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            this.container.logger.error('[ListCrons] Failed to list cronjobs:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching cronjobs. Please try again later.',
            });
        }
    }
}


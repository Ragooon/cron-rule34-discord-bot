import {Command, RegisterBehavior} from '@sapphire/framework';
import {PermissionFlagsBits, MessageFlags, InteractionContextType} from 'discord.js';
import {CronService} from '../lib/cronService';

export class ToggleCronCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: 'toggle-cron',
            description: 'Enable or disable a cronjob',
        });
    }

    public override registerApplicationCommands(registry: Command.Registry): void {
        registry.registerChatInputCommand((builder) =>
                builder
                    .setName(this.name)
                    .setDescription(this.description)
                    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                    .setContexts(InteractionContextType.Guild)
                    .addStringOption((option) =>
                        option
                            .setName('id')
                            .setDescription('The cronjob ID to toggle')
                            .setRequired(true)
                            .setAutocomplete(true)
                    ),
            {
                guildIds: [],
                idHints: [],
                behaviorWhenNotIdentical: RegisterBehavior.Overwrite
            }
        );
    }

    public override async autocompleteRun(interaction: Command.AutocompleteInteraction): Promise<void> {
        const guildId = interaction.guildId;
        if (!guildId) return;

        const focusedValue = interaction.options.getFocused().toLowerCase();

        try {
            // Get all cronjobs (including inactive)
            const cronjobs = await CronService.getByGuild(guildId, false);

            const filtered = cronjobs
                .filter((job) =>
                    job.id.toLowerCase().includes(focusedValue) ||
                    job.message.toLowerCase().includes(focusedValue) ||
                    (job.name?.toLowerCase().includes(focusedValue) ?? false)
                )
                .map((job) => {
                    const status = job.isActive ? '✅' : '❌';
                    const action = job.isActive ? '→ disable' : '→ enable';
                    const label = job.name || job.message.substring(0, 30);
                    return {
                        name: `${status} ${label}${label.length >= 30 ? '...' : ''} ${action}`,
                        value: job.id,
                    };
                });

            await interaction.respond(filtered.slice(0, 25));
        } catch (error) {
            this.container.logger.error('[ToggleCron] Autocomplete error:', error);
            await interaction.respond([]);
        }
    }

    public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});

        const cronjobId = interaction.options.getString('id', true);
        const guildId = interaction.guildId!;

        try {
            // Find and verify the cronjob
            const cronjob = await CronService.getByIdAndGuild(cronjobId, guildId);

            if (!cronjob) {
                await interaction.editReply({
                    content: '❌ Cronjob not found or it doesn\'t belong to this server.',
                });
                return;
            }

            // Toggle the cronjob
            const updatedCronjob = await CronService.toggle(cronjobId);

            const jobLabel = updatedCronjob.name || `\`${cronjobId.substring(0, 8)}...\``;
            const statusText = updatedCronjob.isActive ? '✅ enabled' : '❌ disabled';

            let replyContent = `Cronjob ${jobLabel} is now **${statusText}**.`;

            // If enabled, show next run time
            if (updatedCronjob.isActive) {
                const redisInfo = await CronService.getRedisJobInfo(cronjobId);
                if (redisInfo.nextRun) {
                    replyContent += `\n\n**Next run:** <t:${Math.floor(redisInfo.nextRun.getTime() / 1000)}:R>`;
                }
            }

            await interaction.editReply({content: replyContent});

        } catch (error) {
            this.container.logger.error('[ToggleCron] Failed to toggle cronjob:', error);
            await interaction.editReply({
                content: '❌ An error occurred while toggling the cronjob. Please try again later.',
            });
        }
    }
}


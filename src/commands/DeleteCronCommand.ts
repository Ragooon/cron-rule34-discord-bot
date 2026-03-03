import {Command, RegisterBehavior} from '@sapphire/framework';
import {PermissionFlagsBits, MessageFlags} from 'discord.js';
import {CronService} from '../lib/cronService';
import {InteractionContextType} from 'discord.js';

export class DeleteCronCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: 'delete-cron',
            description: 'Delete an existing scheduled message (cronjob)',
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
                            .setDescription('The cronjob ID to delete')
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
            const cronjobs = await CronService.getByGuild(guildId);

            const filtered = cronjobs
                .filter((job) =>
                    job.id.toLowerCase().includes(focusedValue) ||
                    job.message.toLowerCase().includes(focusedValue) ||
                    (job.name?.toLowerCase().includes(focusedValue) ?? false)
                )
                .map((job) => {
                    const label = job.name || job.message.substring(0, 40);
                    return {
                        name: `${job.cronExpression} - ${label}${label.length >= 40 ? '...' : ''}`,
                        value: job.id,
                    };
                });

            await interaction.respond(filtered.slice(0, 25));
        } catch (error) {
            this.container.logger.error('[DeleteCron] Autocomplete error:', error);
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

            // Delete using the service (handles both DB and Redis)
            await CronService.delete(cronjobId);

            const jobLabel = cronjob.name || `\`${cronjobId.substring(0, 8)}...\``;

            await interaction.editReply({
                content: `✅ Cronjob ${jobLabel} has been deleted successfully.`,
            });

        } catch (error) {
            this.container.logger.error('[DeleteCron] Failed to delete cronjob:', error);
            await interaction.editReply({
                content: '❌ An error occurred while deleting the cronjob. Please try again later.',
            });
        }
    }
}


import {Command} from '@sapphire/framework';
import {ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits} from 'discord.js';
import {CronService} from '../lib/cronService';
import {
    CommandType,
    getChannelOptions,
    hasAnyOption,
    hasBotPermission,
    parseTags,
    prepareUpdatePayload,
} from "../utils/commandUtils";
import {isValidCron} from "cron-validator";
import {BOORU_CHOICES, BooruServiceFactory} from "../lib/booru";

export class UpdateCronCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: 'update-cron',
            description: 'Update an existing Rule34 cronjob',
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
                            .setDescription('The cronjob ID to update')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('pattern')
                            .setDescription('New cron pattern (e.g., "0 8 * * *" for daily at 8 AM)')
                            .setRequired(false)
                    )
                    .addChannelOption((option) =>
                        option
                            .setName('channel')
                            .setDescription('New channel to send posts to')
                            .addChannelTypes(ChannelType.GuildText)
                            .setRequired(false)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('tags')
                            .setDescription('New Rule34 tags (comma-separated)')
                            .setRequired(false)
                            .setMaxLength(500)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('message')
                            .setDescription('Custom message to include with posts (empty to remove)')
                            .setRequired(false)
                            .setMaxLength(500)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('timezone')
                            .setDescription('New timezone for the cron (e.g., Europe/Berlin)')
                            .setRequired(false)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('name')
                            .setDescription('Optional name/label for this cronjob')
                            .setRequired(false)
                            .setMaxLength(100)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("site")
                            .setDescription("The site to fetch from (default: safebooru)")
                            .setRequired(false)
                            .setChoices(BOORU_CHOICES))
                    .addBooleanOption((option) =>
                        option
                            .setName('active')
                            .setDescription('Enable or disable the cronjob')
                            .setRequired(false)
                    ),
            {idHints: []}
        );
    }

    public override async autocompleteRun(interaction: Command.AutocompleteInteraction): Promise<void> {
        const guildId = interaction.guildId;
        if (!guildId) return;

        const focusedValue = interaction.options.getFocused().toLowerCase();

        try {
            const cronjobs = await CronService.getByGuild(guildId, false);

            const filtered = cronjobs
                .filter((job) =>
                    job.id.toLowerCase().includes(focusedValue) ||
                    job.tags.some(t => t.toLowerCase().includes(focusedValue)) ||
                    (job.name?.toLowerCase().includes(focusedValue) ?? false)
                )
                .map((job) => {
                    const status = job.isActive ? '✅' : '❌';
                    const label = job.name || job.tags.slice(0, 3).join(', ');
                    return {
                        name: `${status} ${job.cronExpression} - ${label}`,
                        value: job.id,
                    };
                });

            await interaction.respond(filtered.slice(0, 25));
        } catch (error) {
            this.container.logger.error('[UpdateCron] Autocomplete error:', error);
            await interaction.respond([]);
        }
    }

    public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});

        const channelOptions = getChannelOptions(interaction, CommandType.Update);

        if (!hasAnyOption(channelOptions)) {
            await interaction.editReply({
                content: '❌ Please provide at least one option to update.',
            });
            return;
        }

        try {
            const cronjob = await CronService.getByIdAndGuild(channelOptions.cronjobId, channelOptions.guildId);

            if (!cronjob) {
                await interaction.editReply({
                    content: '❌ Cronjob not found or it doesn\'t belong to this server.',
                });
                return;
            }

            if (channelOptions.pattern && !isValidCron(channelOptions.pattern)) {
                await interaction.editReply({
                    content: '❌ Invalid cron pattern. Please use a valid cron expression.\n\n' +
                        '**Format:** `minute hour day month weekday`\n' +
                        '**Examples:**\n' +
                        '• `0 8 * * *` - Every day at 8:00 AM\n' +
                        '• `0 */2 * * *` - Every 2 hours\n' +
                        '• `0 9 * * 1` - Every Monday at 9:00 AM',
                });
                return;
            }

            const tags = parseTags(channelOptions.tagsInput);

            const site = channelOptions.site ?? cronjob.booruSite;
            const booruService = BooruServiceFactory.getService(site);

            const tagsValid = await booruService.validateTags(tags);
            if (!tagsValid) {
                await interaction.editReply({
                    content: `❌ No posts found for tags: **${tags.join(', ')}**\n\nPlease check if the tags exist on site.`,
                });
                return;
            }


            if (channelOptions.channel) {
                if (!hasBotPermission(channelOptions.channel, PermissionFlagsBits.SendMessages)) {
                    await interaction.editReply({
                        content: `❌ I don't have permission to send messages in ${channelOptions.channel}.`,
                    });
                    return;
                }

                if (!hasBotPermission(channelOptions.channel, PermissionFlagsBits.EmbedLinks)) {
                    await interaction.editReply({
                        content: `❌ I don't have permission to embed links in ${channelOptions.channel}.`,
                    });
                    return;
                }

            }

            const {updateData, changes} = prepareUpdatePayload(channelOptions, tags);

            const updatedCronjob = await CronService.update(channelOptions.cronjobId, updateData);
            const redisInfo = await CronService.getRedisJobInfo(channelOptions.cronjobId);

            await interaction.editReply({
                content: `✅ Cronjob updated successfully!\n\n` +
                    `**ID:** \`${updatedCronjob.id}\`\n` +
                    `**Changes:**\n${changes.join('\n')}\n\n` +
                    (redisInfo.nextRun ? `**Next run:** <t:${Math.floor(redisInfo.nextRun.getTime() / 1000)}:R>` :
                        updatedCronjob.isActive ? '⚠️ Could not determine next run time' : ''),
            });

        } catch (error) {
            this.container.logger.error('[UpdateCron] Failed to update cronjob:', error);
            await interaction.editReply({
                content: '❌ An error occurred while updating the cronjob. Please try again later.',
            });
        }
    }
}


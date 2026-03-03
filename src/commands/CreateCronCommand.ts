import {Command, RegisterBehavior} from '@sapphire/framework';
import {ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, TextChannel} from 'discord.js';
import {isValidCron} from 'cron-validator';
import {CronService} from '../lib/cronService';
import {CommandType, getChannelOptions, hasBotPermission, parseTags} from "../utils/commandUtils";
import {isNsfwChannel} from "@sapphire/discord.js-utilities";
import {BOORU_CHOICES, BooruServiceFactory} from "../lib/booru";

export class CreateCronCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: 'create-cron',
            description: 'Create a new scheduled Rule34 post cronjob',
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
                            .setName('pattern')
                            .setDescription('Cron pattern (e.g., "0 8 * * *" for daily at 8 AM)')
                            .setRequired(true)
                    )
                    .addChannelOption((option) =>
                        option
                            .setName('channel')
                            .setDescription('The channel to send posts to')
                            .addChannelTypes(ChannelType.GuildText)
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('tags')
                            .setDescription('Rule34 tags (comma-separated, e.g., "character_name, rating:safe")')
                            .setRequired(true)
                            .setMaxLength(500)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('timezone')
                            .setDescription('Timezone for the cron (default: UTC)')
                            .setRequired(false)
                    )
                    .addStringOption((option) =>
                        option
                            .setName('message')
                            .setDescription('Optional custom message to include with posts')
                            .setRequired(false)
                            .setMaxLength(500)
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
                            //.setAutocomplete(true)
                            .setChoices(BOORU_CHOICES)),
            {
                guildIds: ["430980608257294336"],
                idHints: [],
                behaviorWhenNotIdentical: RegisterBehavior.Overwrite
            }
        );
    }

    public override async chatInputRun(interaction: Command.ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});

        const channelOptions = getChannelOptions(interaction, CommandType.Create);

        const tags = parseTags(channelOptions.tagsInput);

        console.log('[CreateCron] Parsed tags:', tags);

        if (tags.length === 0) {
            await interaction.editReply({
                content: '❌ Please provide at least one valid tag.',
            });
            return;
        }

        if (!isValidCron(channelOptions.pattern!)) {
            await interaction.editReply({
                content: '❌ Invalid cron pattern. Please use a valid cron expression (e.g., `0 8 * * *`).\n\n' +
                    '**Format:** `minute hour day month weekday`\n' +
                    '**Examples:**\n' +
                    '• `0 8 * * *` - Every day at 8:00 AM\n' +
                    '• `0 */2 * * *` - Every 2 hours\n' +
                    '• `0 9 * * 1` - Every Monday at 9:00 AM',
            });
            return;
        }

        const booruService = BooruServiceFactory.getService(channelOptions.site!);

        const tagsValid = await booruService.validateTags(tags);
        if (!tagsValid) {
            await interaction.editReply({
                content: `❌ No posts found for tags: **${tags.join(', ')}**\n\nPlease check if the tags exist on Rule34.`,
            });
            return;
        }

        // Check bot permissions in target channel

        const channel = channelOptions.channel!;
        if (!hasBotPermission(channel, PermissionFlagsBits.SendMessages)) {
            await interaction.editReply({
                content: `❌ I don't have permission to send messages in ${channel}.`,
            });
            return;
        }

        if (!hasBotPermission(channel, PermissionFlagsBits.EmbedLinks)) {
            await interaction.editReply({
                content: `❌ I don't have permission to embed links in ${channel}.`,
            });
            return;
        }

        if (booruService.isNSFW() && !isNsfwChannel(channel)) {
            await interaction.editReply({
                content: `❌ The selected channel ${channel} is not marked as NSFW. Please choose an NSFW channel for adult content.`,
            });
            return;
        }

        try {
            const existingCount = await CronService.countByGuild(channelOptions.guildId);

            if (existingCount >= 25) {
                await interaction.editReply({
                    content: '❌ Maximum limit reached (25 per server). Please delete some before creating new ones.',
                });
                return;
            }

            const cronjob = await CronService.create({
                guildId: channelOptions.guildId,
                channelId: channel.id,
                cronExpression: channelOptions.pattern!,
                timezone: channelOptions.timezone!,
                tags,
                message: channelOptions.message || undefined,
                name: channelOptions.name || undefined,
                site: channelOptions.site!
            });

            // Get next run info
            const redisInfo = await CronService.getRedisJobInfo(cronjob.id);

            await interaction.editReply({
                content: `✅ Cronjob created successfully!\n\n` +
                    `**ID:** \`${cronjob.id}\`\n` +
                    (cronjob.name ? `**Name:** ${cronjob.name}\n` : '') +
                    `**Pattern:** \`${cronjob.cronExpression}\`\n` +
                    `**Timezone:** \`${cronjob.timezone}\`\n` +
                    `**Channel:** ${channel}\n` +
                    `**Site:** ${channelOptions.site}\n` +
                    `**Tags:** ${tags.join(', ')}\n` +
                    (cronjob.message ? `**Message:** ${cronjob.message}\n` : '') +
                    `\n` +
                    (redisInfo.nextRun ? `**Next run:** <t:${Math.floor(redisInfo.nextRun.getTime() / 1000)}:R>` : ''),
            });

        } catch (error) {
            this.container.logger.error('[CreateCron] Failed to create cronjob:', error);
            await interaction.editReply({
                content: '❌ An error occurred while creating the cronjob. Please try again later.',
            });
        }
    }
}


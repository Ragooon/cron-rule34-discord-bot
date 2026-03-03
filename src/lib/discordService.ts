import { container } from '@sapphire/framework';
import { EmbedBuilder, TextChannel, ChannelType, PermissionFlagsBits, type APIEmbed } from 'discord.js';
import type { BooruPost } from './booru';

export interface DiscordMessageOptions {
    content?: string;
    embeds?: APIEmbed[];
}

export class DiscordService {
    static createRule34Embed(post: BooruPost, tags: string[]): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setColor(0xAAE5A4)
            .setTitle('🔞 Rule34 Post')
            .setURL(post.postView)
            .setImage(post.fileUrl)
            .setFooter({ text: `ID: ${post.id} | Score: ${post.score}` })
            .setTimestamp();

        if (tags.length > 0) {
            embed.setDescription(`**Tags:** ${tags.join(', ')}`);
        }

        if (post.source && post.source !== 'Unknown') {
            embed.addFields({ name: 'Source', value: post.source, inline: true });
        }

        return embed;
    }

    static createErrorEmbed(message: string): EmbedBuilder {
        return new EmbedBuilder()
            .setColor(0xFF5555)
            .setTitle('❌ Error')
            .setDescription(message)
            .setTimestamp();
    }

    static createNoResultsEmbed(tags: string[]): EmbedBuilder {
        return new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle('🔍 No results found :(')
            .setDescription(
                tags.length > 0
                    ? `No tags found: **${tags.join(', ')}**`
                    : 'No Posts found.'
            )
            .setTimestamp();
    }

    static async sendToChannel(
        channelId: string,
        options: DiscordMessageOptions
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const channel = await container.client.channels.fetch(channelId);

            if (!channel) {
                return { success: false, error: 'Channel not found' };
            }

            if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
                return { success: false, error: 'Channel is not a text channel' };
            }

            const textChannel = channel as TextChannel;

            const permissions = textChannel.permissionsFor(container.client.user!);
            if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
                return { success: false, error: 'Missing SendMessages permission' };
            }

            if (options.embeds && options.embeds.length > 0 && !permissions?.has(PermissionFlagsBits.EmbedLinks)) {
                return { success: false, error: 'Missing EmbedLinks permission' };
            }

            await textChannel.send(options);
            return { success: true };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: errorMessage };
        }
    }

}




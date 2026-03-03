import { Command } from "@sapphire/framework";
import { PermissionResolvable, TextChannel } from "discord.js";
import { CronService } from "../lib/cronService";

export interface ChannelOptions {
    cronjobId: string;
    pattern: string | null;
    channel: TextChannel | null;
    tagsInput: string | null;
    message: string | null;
    timezone: string | null;
    name: string | null;
    isActive: boolean | null;
    site: string | null;
    guildId: string;
}

export enum CommandType {
    Create,
    Update
}

export function getChannelOptions(interaction: Command.ChatInputCommandInteraction, commandType: CommandType): ChannelOptions {
    return {
        cronjobId: interaction.options.getString('id', commandType === CommandType.Update)!,
        pattern: interaction.options.getString('pattern', commandType === CommandType.Create),
        channel: interaction.options.getChannel('channel', commandType === CommandType.Create ) as TextChannel | null,
        tagsInput: interaction.options.getString('tags', commandType === CommandType.Create),
        message: interaction.options.getString('message'),
        timezone: interaction.options.getString('timezone') ?? (commandType === CommandType.Create ? 'UTC' : null),
        name: interaction.options.getString('name'),
        isActive: interaction.options.getBoolean('active'),
        site: interaction.options.getString('site') ?? (commandType === CommandType.Create ? 'safebooru' : null),
        guildId: interaction.guildId!,
    };
}

export function hasAnyOption(options: ChannelOptions): boolean {
    return [
        options.pattern,
        options.channel,
        options.tagsInput,
        options.message,
        options.timezone,
        options.name,
        options.isActive,
        options.site
    ].some(value => value !== null && value !== undefined && value !== '');
}

export function parseTags(tags: string | null): string[] {
    if (!tags) return [];
    return tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
}

export function hasBotPermission(channel: TextChannel, permission: PermissionResolvable): boolean {
    const permissions = channel.permissionsFor(channel.client.user!);
    return permissions?.has(permission) ?? false;
}

export function prepareUpdatePayload(options: ChannelOptions, parsedTags?: string[]) {
    const updateData: Partial<Parameters<typeof CronService.update>[1]> = {};
    const changes: string[] = [];

    if (options.pattern) {
        updateData.cronExpression = options.pattern;
        changes.push(`**Pattern:** \`${options.pattern}\``);
    }

    if (options.channel) {
        updateData.channelId = options.channel.id;
        changes.push(`**Channel:** ${options.channel}`);
    }

    const finalTags = parsedTags || (options.tagsInput ? parseTags(options.tagsInput) : []);
    if (finalTags.length > 0) {
        updateData.tags = finalTags;
        changes.push(`**Tags:** ${finalTags.join(', ')}`);
    }

    if (options.timezone) {
        updateData.timezone = options.timezone;
        changes.push(`**Timezone:** \`${options.timezone}\``);
    }

    if (options.message !== null) {
        updateData.message = options.message === "" ? undefined : options.message;
        changes.push(`**Message:** ${updateData.message ? updateData.message : '*(cleared)*'}`);
    }

    if (options.name !== null) {
        updateData.name = options.name === "" ? null : options.name;
        changes.push(`**Name:** ${updateData.name ? updateData.name : '*(cleared)*'}`);
    }

    if (options.isActive !== null) {
        updateData.isActive = options.isActive;
        changes.push(`**Status:** ${options.isActive ? '✅ Enabled' : '❌ Disabled'}`);
    }

    if (options.site !== null) {
        updateData.booruSite = options.site;
        changes.push(`**Site:** ${options.site}`);
    }

    return { updateData: updateData as Parameters<typeof CronService.update>[1], changes };
}
require('dotenv').config();

const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const requiredEnvironment = ['DISCORD_TOKEN'];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
  throw new Error(`Missing environment variables: ${missingEnvironment.join(', ')}`);
}

const botStartedAt = Date.now();

const commands = [
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((option) => option.setName('member').setDescription('Member to kick.').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the kick.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server.')
    .addUserOption((option) => option.setName('member').setDescription('Member to ban.').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('Ban duration, e.g. 2h or 3d. Blank is permanent.'))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server.')
    .addStringOption((option) => option.setName('user_id').setDescription('ID of the banned user.').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the unban.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member for up to 28 days.')
    .addUserOption((option) => option.setName('member').setDescription('Member to timeout.').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('Timeout duration, e.g. 1h or 2d.').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the timeout.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('removetimeout')
    .setDescription('Remove a member timeout.')
    .addUserOption((option) => option.setName('member').setDescription('Member whose timeout to remove.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName('servermute')
    .setDescription('Give a member the server mute role.')
    .addUserOption((option) => option.setName('member').setDescription('Member to mute.').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('Mute duration, e.g. 1h or 2d. Blank is permanent.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove the Muted role from a member.')
    .addUserOption((option) => option.setName('member').setDescription('Member to unmute.').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('clearmasage')
    .setDescription('Delete all messages from this text or voice channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set or clear your AFK status.')
    .addStringOption((option) => option.setName('message').setDescription('Your AFK message.'))
    .addIntegerOption((option) => option.setName('minutes').setDescription('How long to stay AFK, in minutes.').setMinValue(1).setMaxValue(10080)),
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement in this channel.')
    .addStringOption((option) => option.setName('message').setDescription('Announcement text.').setRequired(true))
    .addChannelOption((option) => option.setName('channel').setDescription('Where to post the announcement.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information about the current server.'),
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Show the bot latency, start date, and uptime.'),
  new SlashCommandBuilder()
    .setName('punishmentlist')
    .setDescription('Show members with bans, active timeouts, or server mutes.'),
  new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a direct message to a user.')
    .addUserOption((option) => option.setName('user').setDescription('User who should receive the message.').setRequired(true))
    .addStringOption((option) => option.setName('message').setDescription('Message to send.').setMaxLength(2000).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('DM every non-bot member. Owner only.')
    .addStringOption((option) => option.setName('message').setDescription('Message to send.').setRequired(true))
    .addStringOption((option) => option.setName('confirm').setDescription('Type SEND to confirm.').setRequired(true)),
].map((command) => command.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const afkUsers = new Map();
const banTimers = new Map();
const muteTimers = new Map();
const muteRoleName = 'Muted';

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

async function isApplicationOwner(userId) {
  const application = await client.application.fetch();
  if (application.owner?.id === userId) return true;
  return Boolean(application.owner?.members?.has(userId));
}

function getReason(interaction) {
  return interaction.options.getString('reason') || `Requested by ${interaction.user.tag}`;
}

function parseDuration(value) {
  const duration = value?.trim().toLowerCase();
  if (!duration) return null;
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const milliseconds = amount * (match[2] === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  return amount > 0 && Number.isSafeInteger(milliseconds) ? milliseconds : 0;
}

function scheduleUnban(guildId, userId, duration) {
  const key = `${guildId}:${userId}`;
  const expiresAt = Date.now() + duration;
  const schedule = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      client.guilds.fetch(guildId)
        .then((guild) => guild.members.unban(userId, 'Temporary ban expired'))
        .catch(() => null)
        .finally(() => banTimers.delete(key));
      return;
    }

    const timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    banTimers.set(key, timer);
  };

  const existingTimer = banTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  schedule();
}

function scheduleUnmute(guildId, userId, duration) {
  const key = `${guildId}:${userId}`;
  const expiresAt = Date.now() + duration;
  const schedule = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      client.guilds.fetch(guildId)
        .then(async (guild) => {
          const member = await guild.members.fetch(userId).catch(() => null);
          const role = guild.roles.cache.find((candidate) => candidate.name === muteRoleName);
          if (member && role) await member.roles.remove(role, 'Temporary server mute expired');
        })
        .catch(() => null)
        .finally(() => muteTimers.delete(key));
      return;
    }

    const timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    muteTimers.set(key, timer);
  };

  const existingTimer = muteTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  schedule();
}

function formatUptime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function canActOnMember(interaction, target) {
  if (!target) return 'That user is not a member of this server.';
  if (target.id === interaction.user.id) return 'You cannot use this command on yourself.';
  if (target.id === interaction.guild.ownerId) return 'The server owner cannot be moderated.';
  if (target.roles.highest.position >= interaction.member.roles.highest.position) return 'That member has an equal or higher role than you.';
  if (!target.manageable) return 'My role must be above that member in the role list.';
  return null;
}

async function getMuteRole(guild) {
  let role = guild.roles.cache.find((candidate) => candidate.name === muteRoleName);
  if (!role) {
    role = await guild.roles.create({ name: muteRoleName, reason: 'Created for /servermute' });
  }
  return role;
}

async function configureMuteRole(guild, role) {
  const updates = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread?.() || !channel.permissionOverwrites) continue;
    const permissions = channel.isVoiceBased()
      ? { Speak: false, Connect: false }
      : { SendMessages: false, AddReactions: false };
    updates.push(channel.permissionOverwrites.edit(role, permissions).catch(() => null));
  }
  await Promise.all(updates);
}

client.once(Events.ClientReady, async (readyClient) => {
  if (readyClient.user.username !== 'Xzy Bot') {
    await readyClient.user.setUsername('Xzy Bot').catch((error) => {
      console.error(`Could not update bot name: ${error.message}`);
    });
  }
  await registerCommands();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const mentionedAfkUser = message.mentions.users.find((user) => {
    const afkEntry = afkUsers.get(user.id);
    if (!afkEntry) return false;
    if (afkEntry.expiresAt && afkEntry.expiresAt <= Date.now()) {
      afkUsers.delete(user.id);
      return false;
    }
    return true;
  });

  if (mentionedAfkUser) {
    const afkEntry = afkUsers.get(mentionedAfkUser.id);
    const afkMessage = afkEntry.message
      ? `${mentionedAfkUser.username} is on AFK: ${afkEntry.message}`
      : `${mentionedAfkUser.username} This User Is On Afk`;
    await message.reply(afkMessage);
  }

  const afkEntry = afkUsers.get(message.author.id);
  if (afkEntry) {
    if (afkEntry.expiresAt && afkEntry.expiresAt <= Date.now()) {
      afkUsers.delete(message.author.id);
    } else {
      afkUsers.delete(message.author.id);
      await message.reply('Welcome back. Your AFK status has been cleared.');
    }
  }

});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'afk') {
      const message = interaction.options.getString('message') || '';
      const minutes = interaction.options.getInteger('minutes');
      if (!message && !minutes) {
        afkUsers.delete(interaction.user.id);
        await interaction.reply('Your AFK status has been cleared.');
        return;
      }
      const expiresAt = minutes ? Date.now() + minutes * 60 * 1000 : null;
      afkUsers.set(interaction.user.id, { message, expiresAt });
      await interaction.reply(`Your AFK status is set${message ? `: ${message}` : ''}${minutes ? ` for ${minutes} minute(s).` : '.'}`);
      return;
    }

    if (interaction.commandName === 'botinfo') {
      const gatewayLatency = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'Unavailable';
      const interactionLatency = `${Math.max(0, Date.now() - interaction.createdTimestamp)}ms`;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Xzy Bot Information')
        .addFields(
          { name: 'Gateway Latency', value: gatewayLatency, inline: true },
          { name: 'Response Latency', value: interactionLatency, inline: true },
          { name: 'Bot Started', value: `<t:${Math.floor(botStartedAt / 1000)}:F>`, inline: false },
          { name: 'Uptime', value: formatUptime(Date.now() - botStartedAt), inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === 'serverinfo') {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }

      const owner = await interaction.guild.fetchOwner().catch(() => null);
      const onlineMembers = interaction.guild.members.cache.filter((member) => member.presence?.status && member.presence.status !== 'offline').size;
      const botMembers = interaction.guild.members.cache.filter((member) => member.user.bot).size;
      const textChannels = interaction.guild.channels.cache.filter((channel) => channel.isTextBased() && !channel.isThread?.()).size;
      const voiceChannels = interaction.guild.channels.cache.filter((channel) => channel.isVoiceBased()).size;
      const boostLevel = interaction.guild.premiumTier === 'NONE' ? '0' : interaction.guild.premiumTier.replace('TIER_', 'Tier ');
      const iconUrl = interaction.guild.iconURL({ dynamic: true, size: 512 });
      const features = interaction.guild.features.map((feature) => feature.replaceAll('_', ' ').toLowerCase()).join(', ') || 'None';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(interaction.guild.name)
        .addFields(
          { name: 'Server ID', value: interaction.guild.id, inline: true },
          { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
          { name: 'Members', value: `${interaction.guild.memberCount.toLocaleString()} total • ${onlineMembers.toLocaleString()} online • ${botMembers.toLocaleString()} bots`, inline: true },
          { name: 'Roles', value: interaction.guild.roles.cache.size.toString(), inline: true },
          { name: 'Channels', value: interaction.guild.channels.cache.size.toString(), inline: true },
          { name: 'Text Channels', value: textChannels.toString(), inline: true },
          { name: 'Voice Channels', value: voiceChannels.toString(), inline: true },
          { name: 'Emojis', value: interaction.guild.emojis.cache.size.toString(), inline: true },
          { name: 'Boost Level', value: boostLevel, inline: true },
          { name: 'Boosts', value: interaction.guild.premiumSubscriptionCount.toLocaleString(), inline: true },
          { name: 'Verification', value: interaction.guild.verificationLevel.toString(), inline: true },
          { name: 'Features', value: features.slice(0, 1024), inline: false },
          { name: 'Created', value: `<t:${Math.floor(interaction.guild.createdTimestamp / 1000)}:F>`, inline: false },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      if (iconUrl) embed.setThumbnail(iconUrl);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'punishmentlist') {
      const bans = await interaction.guild.bans.fetch().catch(() => null);
      const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
      const mutedRole = interaction.guild.roles.cache.find((role) => role.name === muteRoleName);
      const now = Date.now();
      const timeouts = members.filter((member) => member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > now);
      const mutedMembers = mutedRole ? members.filter((member) => member.roles.cache.has(mutedRole.id)) : [];
      const formatEntries = (entries, emptyText = 'None') => entries.length ? entries.join('\n').slice(0, 1024) : emptyText;
      const banEntries = bans ? bans.map((ban) => `${ban.user.tag} (${ban.user.id})`) : [];
      const timeoutEntries = [...timeouts.values()].map((member) => `${member.user.tag} - <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`);
      const muteEntries = [...mutedMembers.values()].map((member) => `${member.user.tag} (${member.user.id})`);
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Punishment List')
        .addFields(
          { name: `Banned (${banEntries.length})`, value: formatEntries(banEntries), inline: false },
          { name: `Timed Out (${timeoutEntries.length})`, value: formatEntries(timeoutEntries), inline: false },
          { name: `Server Muted (${muteEntries.length})`, value: formatEntries(muteEntries), inline: false },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.commandName === 'unban') {
      const userId = interaction.options.getString('user_id');
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) {
        await interaction.reply({ content: 'That user is not currently banned, or the user ID is invalid.', ephemeral: true });
        return;
      }
      await interaction.guild.members.unban(userId, getReason(interaction));
      await interaction.reply(`${ban.user.tag} was unbanned.`);
      return;
    }

    if (interaction.commandName === 'removetimeout' || interaction.commandName === 'unmute') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member').id);
      const validationError = canActOnMember(interaction, target);
      if (validationError) {
        await interaction.reply({ content: validationError, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'removetimeout') {
        await target.timeout(null, `Timeout removed by ${interaction.user.tag}`);
        await interaction.reply(`${target.user.tag}'s timeout was removed.`);
      } else {
        const role = interaction.guild.roles.cache.find((candidate) => candidate.name === muteRoleName);
        if (!role || !target.roles.cache.has(role.id)) {
          await interaction.reply({ content: `${target.user.tag} is not muted.`, ephemeral: true });
          return;
        }
        await target.roles.remove(role, `Unmuted by ${interaction.user.tag}`);
        await interaction.reply(`${target.user.tag} was unmuted.`);
      }
      return;
    }

    if (interaction.commandName === 'kick' || interaction.commandName === 'ban' || interaction.commandName === 'timeout' || interaction.commandName === 'servermute') {
      const target = await interaction.guild.members.fetch(interaction.options.getUser('member').id);
      const validationError = canActOnMember(interaction, target);
      if (validationError) {
        await interaction.reply({ content: validationError, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'kick') {
        await target.kick(getReason(interaction));
        await interaction.reply(`${target.user.tag} was kicked.`);
      } else if (interaction.commandName === 'ban') {
        const durationInput = interaction.options.getString('duration');
        const duration = parseDuration(durationInput);
        if (duration === 0) {
          await interaction.reply({ content: 'Invalid duration. Use a format like 2h or 3d, or leave it blank for a permanent ban.', ephemeral: true });
          return;
        }
        await target.ban({ reason: getReason(interaction) });
        if (duration) {
          scheduleUnban(interaction.guild.id, target.id, duration);
          await interaction.reply(`${target.user.tag} was banned for ${durationInput}.`);
        } else {
          await interaction.reply(`${target.user.tag} was banned permanently.`);
        }
      } else if (interaction.commandName === 'timeout') {
        const durationInput = interaction.options.getString('duration');
        const duration = parseDuration(durationInput);
        if (!duration || duration > 28 * 24 * 60 * 60 * 1000) {
          await interaction.reply({ content: 'Invalid timeout duration. Use 1h to 28d, for example 1h or 2d.', ephemeral: true });
          return;
        }
        await target.timeout(duration, getReason(interaction));
        await interaction.reply(`${target.user.tag} was timed out for ${durationInput}.`);
      } else {
        const durationInput = interaction.options.getString('duration');
        const duration = parseDuration(durationInput);
        if (duration === 0) {
          await interaction.reply({ content: 'Invalid mute duration. Use a format like 1h or 2d, or leave it blank for a permanent mute.', ephemeral: true });
          return;
        }
        const role = await getMuteRole(interaction.guild);
        if (role.position >= interaction.guild.members.me.roles.highest.position) {
          await interaction.reply({ content: 'My role must be above the Muted role.', ephemeral: true });
          return;
        }
        await configureMuteRole(interaction.guild, role);
        await target.roles.add(role, `Muted by ${interaction.user.tag}`);
        if (duration) {
          scheduleUnmute(interaction.guild.id, target.id, duration);
          await interaction.reply(`${target.user.tag} was muted for ${durationInput}.`);
        } else {
          await interaction.reply(`${target.user.tag} was muted permanently.`);
        }
      }
      return;
    }

    if (interaction.commandName === 'announce') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel.isTextBased() || !channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        await interaction.reply({ content: 'I cannot send messages in that channel.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Server Announcement')
        .setDescription(interaction.options.getString('message'))
        .setFooter({ text: `Posted by ${interaction.user.tag}` })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: 'Announcement posted.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'send') {
      const user = interaction.options.getUser('user');
      const message = interaction.options.getString('message');
      try {
        await user.send(message);
        await interaction.reply({ content: `Message sent to ${user.tag}.`, ephemeral: true });
      } catch {
        await interaction.reply({ content: `I could not send a DM to ${user.tag}. Their DMs may be closed.`, ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === 'dmall') {
      if (!(await isApplicationOwner(interaction.user.id))) {
        await interaction.reply({ content: 'Only the configured bot owner can use this command.', ephemeral: true });
        return;
      }
      if (interaction.options.getString('confirm') !== 'SEND') {
        await interaction.reply({ content: 'Type SEND in the confirmation option to continue.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const members = await interaction.guild.members.fetch();
      let sent = 0;
      let failed = 0;
      for (const member of members.values()) {
        if (member.user.bot) continue;
        try {
          await member.send(interaction.options.getString('message'));
          sent += 1;
        } catch {
          failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await interaction.editReply(`DMs sent: ${sent}. Failed or closed DMs: ${failed}.`);
    }
  } catch (error) {
    console.error(error);
    const response = { content: 'The command failed. Check the bot permissions and role hierarchy.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(response);
    else await interaction.reply(response);
  }
});

client.login(process.env.DISCORD_TOKEN);

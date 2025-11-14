import axios from "axios";

const TOKENS: string[] = [
    "",
    "",
    "",
    "",
    "",
    "",
];
const GUILD_ID = "";
const DEFAULT_VALUE = "pokemon"
const SPEED = 1000

const FULL_PERMS = (1n << 53n) - 1n;
const PERMS = {
    ADMIN: 1n << 3n,
    VIEW: 1n << 10n,
    SEND: 1n << 11n,
    SLASH: 1n << 31n,
    CONNECT: 1n << 20n,
};

interface DiscordUser {
    id: string;
    username: string;
    global_name?: string;
}

interface DiscordRole {
    id: string;
    name: string;
    position: number;
    permissions: string;
}

interface DiscordMember {
    roles: string[];
}

interface DiscordChannel {
    id: string;
    name: string;
    type: number;
    parent_id?: string;
    permission_overwrites: {
        id: string;
        type: number;
        allow: string;
        deny: string;
    }[];
}

let IsToken: { token: string; user: string; roles: DiscordRole[], id: string }[] = [];
let IsChannel: { id: string; name: string }[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -------------------- Verify Token --------------------
async function Verify(token: string): Promise<void> {
    try {
        const { data: user } = await axios.get<DiscordUser>("https://discord.com/api/v10/users/@me", { headers: { Authorization: token } });
        const { data: member } = await axios.get<DiscordMember>(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${user.id}`, { headers: { Authorization: token } });
        const { data: roles } = await axios.get<DiscordRole[]>(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, { headers: { Authorization: token } });

        const everyone = roles.find((r) => r.id === GUILD_ID);
        const userRoles = [
            ...(roles.filter((r) => member.roles.includes(r.id))),
            ...(everyone ? [everyone] : []),
        ];

        console.log(`[✅] [${user.global_name || user.username}] joined the server`);
        console.log(`     └─ Roles: ${userRoles.map((r) => r.name).join(", ")}`);

        IsToken.push({
            token,
            user: user.global_name || user.username,
            roles: userRoles,
            id: user.id,
        });
    } catch {
        // console.log(`[❌] Invalid or Not-in-server Token`);
    }
}

// -------------------- Permission Calculation (client-accurate) --------------------
function hasPermission(perms: bigint, flag: bigint): boolean {
    return (perms & flag) === flag;
}

function computeBasePermissions(memberRoles: DiscordRole[]): bigint {
    let perms = 0n;
    for (const role of memberRoles) perms |= BigInt(role.permissions);

    if ((perms & PERMS.ADMIN) === PERMS.ADMIN) return FULL_PERMS;
    return perms;
}

function computeOverwrites(basePerms: bigint, channel: DiscordChannel, allChannels: Map<string, DiscordChannel>, memberRoles: DiscordRole[], guildId: string, userId: string): bigint {
    let perms = basePerms;

    if (channel.parent_id) {
        const parent = allChannels.get(channel.parent_id);
        if (parent)
            perms = computeOverwrites(perms, parent, allChannels, memberRoles, guildId, userId);
    }

    const everyone = channel.permission_overwrites.find(o => o.id === guildId);
    if (everyone) {
        perms &= ~BigInt(everyone.deny);
        perms |= BigInt(everyone.allow);
    }

    const nonEveryoneRoles = memberRoles.filter(r => r.id !== guildId);
    const highestRole = nonEveryoneRoles.sort((a, b) => b.position - a.position)[0];

    if (highestRole) {
        const highestOverwrite = channel.permission_overwrites.find(o => o.id === highestRole.id && o.type === 0);
        if (highestOverwrite) {
            perms &= ~BigInt(highestOverwrite.deny);
            perms |= BigInt(highestOverwrite.allow);
        }
    }

    const userOverwrite = channel.permission_overwrites.find(o => o.type === 1 && o.id === userId);
    if (userOverwrite) {
        perms &= ~BigInt(userOverwrite.deny);
        perms |= BigInt(userOverwrite.allow);
    }

    if ((perms & PERMS.ADMIN) === PERMS.ADMIN) perms = FULL_PERMS;

    return perms;
}

// -------------------- Channel Analyzer --------------------
async function GetServerChannels(token: string, roles: DiscordRole[], userId?: string) {
    try {

        const { data: channels } = await axios.get<DiscordChannel[]>(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, { headers: { Authorization: token } });

        const channelMap = new Map(channels.map(ch => [ch.id, ch]));
        const basePerms = computeBasePermissions(roles);

        for (const ch of channels) {
            if (ch.type === 4) continue;

            const perms = computeOverwrites(basePerms, ch, channelMap, roles, GUILD_ID, userId!);

            const canView = hasPermission(perms, PERMS.VIEW);
            const canSend = canView && hasPermission(perms, PERMS.SEND);
            const canConnect = canView && hasPermission(perms, PERMS.CONNECT);
            const canSlash = canView && hasPermission(perms, PERMS.SLASH);
            const isAdmin = hasPermission(perms, PERMS.ADMIN);
            

            if (isAdmin) {
                // console.log(`[🟢] ${ch.name} (${ch.id}) [Administrator Access]`);
                IsChannel.push({ id: ch.id, name: ch.name });
                continue;
            }

            if (ch.type === 2) {
                if (canView && canConnect && canSlash) {
                    // console.log(`[✅] ${ch.name} (${ch.id}) [Voice: Connect + Slash OK]`);
                    IsChannel.push({ id: ch.id, name: ch.name });
                } else if (canView && canConnect) {
                    // console.log(`[⚠️] ${ch.name} (${ch.id}) [Voice: Connect: True ❌ No Slash]`);
                } else {
                    // console.log(`[⛔] ${ch.name} (${ch.id})[Voice: No Connect/View]`);
                }
            } else {
                if (canView && canSend && canSlash) {
                    // console.log(`[✅] ${ch.name} (${ch.id}) [Text: Full Access]`);
                    IsChannel.push({ id: ch.id, name: ch.name });
                } else if (canView && canSend) {
                    // console.log(`[⚠️] ${ch.name} (${ch.id}) [Text: No Slash Commands]`);
                } else {
                    // console.log(`[⛔] ${ch.name} (${ch.id}) [Text: No Access]`);
                }
            }
        }
    } catch (e: any) {
        console.log("[❌] Failed to fetch channels:", e?.response?.data || e);
    }
}

// -------------------- Send Api SlashCommands --------------------

async function SendCommand(token: string, channel_id: string): Promise<void> {
    const body = {
        type: 2,
        application_id: "161660517914509312",
        guild_id: GUILD_ID,
        channel_id,
        session_id: "320bd6b04565910e5ccb1716bfd449d8",
        data: {
            version: "1116144106687692895",
            id: "824701594749763611",
            name: "tag",
            type: 1,
            options: [
                {
                    type: 1,
                    name: "get",
                    options: [{ type: 3, name: "name", value: DEFAULT_VALUE }],
                },
            ],
        },
    };

    try {
        await axios.post("https://discord.com/api/v10/interactions", body, {
            headers: {
                Authorization: token,
                "Content-Type": "application/json",
            },
        });

    } catch (err: any) {
        console.log(`[❌] Failed to send command (${channel_id}):`, err?.response?.data || err);
    }
}

// -------------------- Run --------------------

(async () => {
    console.clear();
    await Promise.all(TOKENS.map(t => Verify(t)));

    if (IsToken.length === 0) {
        console.log("[❌] No valid tokens found for this server.");
        return;
    }

    const first = IsToken[0];
    // console.log(`\n[📡] Fetching channels using ${first.user}...\n`);
    await GetServerChannels(first.token, first.roles, first.id);

    if (IsChannel.length === 0) {
        console.log("[❌] No suitable channels found.");
        return;
    }

    console.log("\n[📨] Sending slash commands concurrently... \n");

    while (true) {
        for (let i = 0; i < IsChannel.length; i++) {
            const channel = IsChannel[i];
            const tokenData = IsToken[i % IsToken.length];
        
            console.log(`[⌛] [${tokenData.user}] Sending command → ${channel.name} (${channel.id})`);

            await SendCommand(tokenData.token, channel.id);
            console.log(`     └─ Sent Complete`);

        
            await sleep(SPEED);
        }
    }
})();
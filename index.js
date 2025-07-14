require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

const OWNER_ID = process.env.OWNER_ID;
const GROUP_ID = process.env.GROUP_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const activeDeals = new Map();
const adminList = new Set();
const upiStore = new Map();
const pendingCaptcha = new Map();

function generateID() {
  return "DEAL" + Date.now();
}

bot.start(async (ctx) => {
  const user = ctx.from;
  const welcomeText = `👋 Welcome *${user.first_name}*\n\nSelect deal type to begin:`;
  await ctx.reply(welcomeText, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💸 INR Deal", "inr_deal")]
    ])
  });
});

bot.action("inr_deal", async (ctx) => {
  const id = generateID();
  const deal = { id, step: 0, data: {}, status: "filling", user: ctx.from.id };
  activeDeals.set(ctx.from.id, deal);
  await ctx.reply("📌 Deal of?");
});

bot.on("text", async (ctx) => {
  const uid = ctx.from.id;
  if (pendingCaptcha.has(uid)) {
    if (ctx.message.text == pendingCaptcha.get(uid)) {
      pendingCaptcha.delete(uid);
      await ctx.reply("✅ Captcha Verified. Now you can use the bot.");
    } else {
      await ctx.reply("❌ Wrong captcha. Try again.");
    }
    return;
  }

  const deal = activeDeals.get(uid);
  if (!deal || deal.status !== "filling") return;

  const stepPrompts = [
    "💰 Total Amount?",
    "⏱ Time to Complete Deal?",
    "🏦 Payment from which Bank (compulsory)?",
    "🔁 Seller Username?",
    "🛒 Buyer Username?"
  ];
  const fields = ["dealOf", "amount", "time", "bank", "seller", "buyer"];

  deal.data[fields[deal.step]] = ctx.message.text;
  deal.step++;

  if (deal.step < stepPrompts.length) {
    await ctx.reply(stepPrompts[deal.step]);
  } else {
    deal.status = "pending";
    const msg = `🆕 *New INR Deal Created!*\n\n📝 *Deal Of:* ${deal.data.dealOf}\n💰 *Amount:* ₹${deal.data.amount}\n⏱ *Time:* ${deal.data.time}\n🏦 *Bank:* ${deal.data.bank}\n👤 *Seller:* ${deal.data.seller}\n👤 *Buyer:* ${deal.data.buyer}\n\n*Deal ID:* ${deal.id}`;
    await bot.telegram.sendMessage(GROUP_ID, msg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Seller Agree", `agree_seller_${deal.id}`)],
        [Markup.button.callback("✅ Buyer Agree", `agree_buyer_${deal.id}`)]
      ])
    });
    await ctx.reply("✅ Deal posted to group.");
  }
});

bot.action(/agree_(seller|buyer)_(DEAL\d+)/, async (ctx) => {
  const role = ctx.match[1];
  const dealId = ctx.match[2];

  for (let [, deal] of activeDeals) {
    if (deal.id === dealId) {
      deal[`${role}Confirmed`] = ctx.from.username || ctx.from.id;
      const status = `${role === "seller" ? "Seller" : "Buyer"} confirmed.`;

      if (deal.buyerConfirmed && deal.sellerConfirmed) {
        await ctx.reply(`✅ Both confirmed.\nAdmin will be notified to claim.`);
        await bot.telegram.sendMessage(OWNER_ID, `🚨 New deal ready for admin claim:\n🆔 *${dealId}*`, {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`🚀 Claim Deal (${dealId})`, `claim_${dealId}`)]
          ])
        });
      } else {
        await ctx.reply(`☑️ ${status}\nWaiting for other party.`);
      }
    }
  }
});

bot.action(/claim_(DEAL\d+)/, async (ctx) => {
  const admin = ctx.from;
  const dealId = ctx.match[1];

  for (let [, deal] of activeDeals) {
    if (deal.id === dealId) {
      deal.claimedBy = admin.username;
      deal.status = "claimed";
      await ctx.reply(`✅ Deal ${dealId} claimed by @${admin.username}`);
      await bot.telegram.sendMessage(GROUP_ID, `🔒 Deal ${dealId} claimed by admin @${admin.username}`);
    }
  }
});

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  await ctx.reply("📢 Send your broadcast message:");
  bot.once("text", async (ctx2) => {
    const text = ctx2.message.text;
    for (let [, deal] of activeDeals) {
      try {
        await bot.telegram.sendMessage(deal.user, `📢 Broadcast:\n${text}`);
      } catch {}
    }
    await ctx2.reply("✅ Broadcast sent.");
  });
});

bot.command("analytics", async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) return;
  const total = [...activeDeals.values()].length;
  const completed = [...activeDeals.values()].filter(d => d.status === "released" || d.status === "refunded").length;
  await ctx.reply(`📊 Deal Analytics:\nTotal: ${total}\nCompleted: ${completed}`);
});

bot.command("search", async (ctx) => {
  const parts = ctx.message.text.split(" ");
  const id = parts[1];
  if (!id) return ctx.reply("❌ Use: /search DEAL_ID");
  for (let [, deal] of activeDeals) {
    if (deal.id === id) {
      return ctx.reply(`📄 Deal Found:\n🆔 ${deal.id}\n👤 Buyer: ${deal.data.buyer}\n👤 Seller: ${deal.data.seller}\n💰 Amount: ₹${deal.data.amount}\nStatus: ${deal.status}`);
    }
  }
  ctx.reply("❌ Deal not found.");
});

bot.use(async (ctx, next) => {
  const uid = ctx.from.id;
  if (ctx.chat.type === "private" && !pendingCaptcha.has(uid)) {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    pendingCaptcha.set(uid, code);
    await ctx.reply(`🔐 Enter this code to continue: *${code}*`, { parse_mode: "Markdown" });
    return;
  }
  return next();
});

bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

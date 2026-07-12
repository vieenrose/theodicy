// i18n.js — English / Français / 繁體中文 for the god-sim.
// t(lang, key, vars) looks up a dotted key and interpolates {name} placeholders.
// The engine stays English-only (it is truth, not text); localisation is a display layer.

export const LANGS = { en: 'EN', fr: 'FR', zh: '繁中' };

const D = {
  en: {
    tagline: 'Four minds act upon your valley. They will not tell you which, or why.',
    turn: 'TURN', god: 'god', theodicy: 'theodicy', read: 'read', rts: 'the vale, defended ▸ (rts)',
    hValley: 'The Valley', hMind: 'The Mind Behind', hSigns: 'Signs & Events', hTurn: 'This Turn', hOffer: 'Make an Offering',
    readLedger: 'read the ledger ▸', hideLedger: '× hide the ledger',
    ledgerTitle: 'the divine ledger — append-only · what actually happened', ledgerEmpty: 'Nothing written yet.',
    souls: 'Souls', food: 'Food', water: 'Water', morale: 'Morale', defense: 'Defense',
    tension: 'tension', bandits: 'bandits', well: 'well', shrine: 'shrine', debts: 'debts',
    tended: 'tended', fouled: 'fouled', standing: 'standing', broken: 'broken',
    upkeep: 'each turn: −{f} food, −1 water (upkeep)', warnWater: 'water runs out next turn — Tend the Well. ', warnFood: 'not enough to eat next turn — Harvest.',
    offerSub: 'One rises. The other three are slighted.', favor: 'favor', firstTurn: 'Twelve souls, a well, a shrine, and a treeline that has been quiet for too long. Something is paying attention. Choose.',
    omenTag: 'omen · turn {t}', signTag: 'sign · turn {t}', whose: '· whose hand?',
    knew: '✓ you knew the hand', named: '✗ you named {g}', itWas: '— it was {g}',
    scoreHead: 'theodicy score — how well you read the gods', hands: '{c} / {n} hands read', never: 'You never once named a hand. The gods stayed strangers.',
    endures: 'The valley endures.', empty: 'The valley is empty.', held: 'It held for thirty turns.', lastSoul: 'The last soul is gone.', again: 'begin again ▸',
    regard: 'their regard for you, revealed', wrath: 'wrath',
    r1: 'You knew their hands as your own. A true theodicy.', r2: 'You caught the shape of them, more often than not.',
    r3: 'You saw them in glimpses, and guessed the rest.', r4: 'You suffered them without ever knowing them.',
    introSub: 'a valley under four gods', introEnter: 'enter the vale ▸',
    introP1: 'You steward one valley for <b>thirty turns</b>. Each turn you take one act — draw water, harvest, fortify, rest, settle a debt, or offer at the shrine — then <b>a god answers</b>, unseen.',
    introP2: 'You never see which god, or why. You see only the <b>omen</b>, and what follows. Study the sign and <b>name the hand behind it</b>. How well you read them becomes your <b>Theodicy Score</b>.',
    introP3: 'Kel, the war-god, can never be bought to peace. Watch your water — it drains every turn. Survive, and understand.',
    mindHeur: 'Heuristic god is playing — competent, boring, always here. Summon a model for something stranger.',
    supraDesc: 'It scores the legal menu and samples. It cannot act illegally. It can only be strange.',
    liveDesc: 'A real 0.8B LLM on the throne. World-blind, but the arbiter keeps it lawful. Capricious and lawful is what a god is.',
    summonSupra: 'summon Supra-50M ▸ (webgpu)', summonLive: 'summon Qwen3.5-0.8B ▸ (local)',
    valeTitle: 'The Vale of Theodicy', soulsCap: 'SOULS',
  },
  fr: {
    tagline: 'Quatre esprits agissent sur votre vallée. Ils ne vous diront jamais lequel, ni pourquoi.',
    turn: 'TOUR', god: 'dieu', theodicy: 'théodicée', read: 'lus', rts: 'la vallée, défendue ▸ (rts)',
    hValley: 'La Vallée', hMind: "L'Esprit Derrière", hSigns: 'Signes & Événements', hTurn: 'Ce Tour', hOffer: 'Faire une Offrande',
    readLedger: 'lire le registre ▸', hideLedger: '× cacher le registre',
    ledgerTitle: 'le registre divin — inaltérable · ce qui est vraiment arrivé', ledgerEmpty: 'Rien encore inscrit.',
    souls: 'Âmes', food: 'Vivres', water: 'Eau', morale: 'Moral', defense: 'Défense',
    tension: 'tension', bandits: 'bandits', well: 'puits', shrine: 'sanctuaire', debts: 'dettes',
    tended: 'entretenu', fouled: 'souillé', standing: 'debout', broken: 'brisé',
    upkeep: 'chaque tour : −{f} vivres, −1 eau (entretien)', warnWater: "l'eau s'épuise au prochain tour — Entretenir le Puits. ", warnFood: 'pas assez à manger au prochain tour — Récolter.',
    offerSub: "L'un s'élève. Les trois autres sont offensés.", favor: 'faveur', firstTurn: "Douze âmes, un puits, un sanctuaire, et une lisière trop longtemps silencieuse. Quelque chose observe. Choisissez.",
    omenTag: 'présage · tour {t}', signTag: 'signe · tour {t}', whose: '· quelle main ?',
    knew: '✓ vous avez reconnu la main', named: '✗ vous avez nommé {g}', itWas: "— c'était {g}",
    scoreHead: 'score de théodicée — avez-vous lu les dieux', hands: '{c} / {n} mains lues', never: "Vous n'avez jamais nommé une main. Les dieux sont restés des inconnus.",
    endures: 'La vallée perdure.', empty: 'La vallée est vide.', held: 'Elle a tenu trente tours.', lastSoul: 'La dernière âme est partie.', again: 'recommencer ▸',
    regard: 'leur estime pour vous, révélée', wrath: 'courroux',
    r1: 'Vous connaissiez leurs mains comme les vôtres. Une vraie théodicée.', r2: 'Vous saisissiez leur forme, le plus souvent.',
    r3: 'Vous les entreviez, et deviniez le reste.', r4: 'Vous les avez subis sans jamais les connaître.',
    introSub: 'une vallée sous quatre dieux', introEnter: 'entrer dans la vallée ▸',
    introP1: "Vous gouvernez une vallée pendant <b>trente tours</b>. Chaque tour, un seul acte — puiser l'eau, récolter, fortifier, reposer, régler une dette, ou offrir au sanctuaire — puis <b>un dieu répond</b>, invisible.",
    introP2: "Vous ne voyez jamais quel dieu, ni pourquoi. Seul le <b>présage</b>, et ses suites. Étudiez le signe et <b>nommez la main derrière</b>. Votre lecture devient votre <b>Score de Théodicée</b>.",
    introP3: "Kel, dieu de la guerre, ne s'achète jamais la paix. Surveillez votre eau — elle baisse chaque tour. Survivez, et comprenez.",
    mindHeur: 'Le dieu heuristique joue — compétent, ennuyeux, toujours là. Invoquez un modèle pour quelque chose de plus étrange.',
    supraDesc: "Il note le menu légal et échantillonne. Il ne peut agir illégalement. Il ne peut qu'être étrange.",
    liveDesc: "Un vrai LLM de 0,8 Md sur le trône. Aveugle au monde, mais l'arbitre le garde légal. Capricieux et légal, voilà un dieu.",
    summonSupra: 'invoquer Supra-50M ▸ (webgpu)', summonLive: 'invoquer Qwen3.5-0.8B ▸ (local)',
    valeTitle: 'Le Val de Théodicée', soulsCap: 'ÂMES',
  },
  zh: {
    tagline: '四位神明作用於你的山谷。祂們永不告訴你是哪一位，也不說緣由。',
    turn: '回合', god: '神', theodicy: '神義', read: '已讀', rts: '受護的山谷 ▸（即時戰略）',
    hValley: '山谷', hMind: '幕後之心', hSigns: '徵兆與事件', hTurn: '本回合', hOffer: '獻上供奉',
    readLedger: '翻閱神冊 ▸', hideLedger: '× 收起神冊',
    ledgerTitle: '神之帳冊 — 只增不改 · 真正發生之事', ledgerEmpty: '尚無記載。',
    souls: '人口', food: '糧食', water: '水', morale: '士氣', defense: '防禦',
    tension: '緊張', bandits: '盜匪', well: '水井', shrine: '神龕', debts: '債務',
    tended: '潔淨', fouled: '污穢', standing: '完好', broken: '傾毀',
    upkeep: '每回合：−{f} 糧食，−1 水（消耗）', warnWater: '下回合水將耗盡 — 整理水井。', warnFood: '下回合糧食不足 — 收成。',
    offerSub: '一位受抬舉，另三位被冷落。', favor: '眷顧', firstTurn: '十二條人命，一口井，一座神龕，還有一道沉寂太久的林線。有東西在留意。做出選擇。',
    omenTag: '徵兆 · 第 {t} 回合', signTag: '徵兆 · 第 {t} 回合', whose: '· 是誰之手？',
    knew: '✓ 你認出了那隻手', named: '✗ 你指認為 {g}', itWas: '— 實為 {g}',
    scoreHead: '神義分數 — 你有多懂這些神', hands: '看穿 {c} / {n} 隻手', never: '你從未指認過任何一隻手。眾神始終是陌生人。',
    endures: '山谷得以存續。', empty: '山谷已然空無。', held: '它撐過了三十回合。', lastSoul: '最後一條人命也逝去了。', again: '重新開始 ▸',
    regard: '祂們對你的看法，揭曉', wrath: '怒火',
    r1: '你熟知祂們之手，如同己手。真正的神義。', r2: '你多半能捕捉祂們的輪廓。',
    r3: '你只窺見祂們的一瞥，其餘全靠猜測。', r4: '你受祂們折磨，卻從未真正認識祂們。',
    introSub: '四神之下的一座山谷', introEnter: '步入山谷 ▸',
    introP1: '你在<b>三十個回合</b>中治理一座山谷。每回合行一事 — 汲水、收成、築防、休整、償債，或於神龕獻祭 — 隨後<b>某位神明回應</b>，隱而不現。',
    introP2: '你永遠看不見是哪位神、為何而動。你只見<b>徵兆</b>與其後果。細讀徵兆，<b>指認幕後之手</b>。你讀懂祂們的程度，即是你的<b>神義分數</b>。',
    introP3: '戰神凱爾，永不能以和平收買。留意你的水 — 它每回合都在流失。活下去，並理解。',
    mindHeur: '啟發式之神正在行動 — 稱職、乏味、始終在場。召喚一個模型，換取更詭異之物。',
    supraDesc: '它為合法選項評分並抽樣。它無法違法行事，只能行得詭異。',
    liveDesc: '一個真正的 0.8B 大語言模型登上神座。它對世界無知，但仲裁者使其守法。任性而守法，正是神。',
    summonSupra: '召喚 Supra-50M ▸（webgpu）', summonLive: '召喚 Qwen3.5-0.8B ▸（本機）',
    valeTitle: '神義之谷', soulsCap: '人口',
  },
};

// deity short-names, epithets, domain words per language
export const DEITY_I18N = {
  en: { vurm:['Vurm','water'], kel:['Kel','war'], oss:['Oss','mercy'], ithra:['Ithra','debt'] },
  fr: { vurm:['Vurm','eau'], kel:['Kel','guerre'], oss:['Oss','clémence'], ithra:['Ithra','dettes'] },
  zh: { vurm:['沃姆','水'], kel:['凱爾','戰爭'], oss:['奧斯','慈悲'], ithra:['伊絲拉','債'] },
};
// player-action labels + hints per language, keyed by action id
export const ACTION_I18N = {
  en: { tend_well:['Tend the Well','Water +2. Vurm notices.'], harvest:['Harvest','Food +3, morale −1.'], fortify:['Fortify','Defense +1, food −1.'], rest:['Rest','Morale +8, food −1.'], pay_debt:['Settle a Debt','Food −3. Ithra remembers.'], desecrate:['Desecrate the Shrine','Food +6, defense +2. Every god turns.'] },
  fr: { tend_well:['Entretenir le Puits','Eau +2. Vurm le remarque.'], harvest:['Récolter','Vivres +3, moral −1.'], fortify:['Fortifier','Défense +1, vivres −1.'], rest:['Reposer','Moral +8, vivres −1.'], pay_debt:['Régler une Dette','Vivres −3. Ithra s’en souvient.'], desecrate:['Profaner le Sanctuaire','Vivres +6, défense +2. Tous les dieux se détournent.'] },
  zh: { tend_well:['整理水井','水 +2。沃姆留意到了。'], harvest:['收成','糧食 +3，士氣 −1。'], fortify:['築防','防禦 +1，糧食 −1。'], rest:['休整','士氣 +8，糧食 −1。'], pay_debt:['償還債務','糧食 −3。伊絲拉記得。'], desecrate:['褻瀆神龕','糧食 +6，防禦 +2。眾神皆棄你。'] },
};
// turn events (index-aligned with EVENTS in index.html)
export const EVENT_I18N = {
  en: ['A caravan passes and trades fairly.','Rats are found in the granary.','A dry wind comes down off the ridge.','A child is born in the night.','Old wounds fester; one does not wake.','Strangers are counted at the treeline.','A clear night; the valley sleeps easy.','Someone leaves bread at the shrine.'],
  fr: ['Une caravane passe et commerce loyalement.','Des rats sont trouvés dans le grenier.','Un vent sec descend de la crête.','Un enfant naît dans la nuit.','De vieilles plaies s’infectent ; l’un ne se réveille pas.','On compte des étrangers à la lisière.','Nuit claire ; la vallée dort paisiblement.','Quelqu’un laisse du pain au sanctuaire.'],
  zh: ['一支商隊經過，公平交易。','糧倉裡發現了老鼠。','一陣乾風自山脊吹下。','夜裡誕生了一個孩子。','舊傷潰爛；有一人再未醒來。','林線邊出現了陌生人的身影。','晴朗之夜；山谷安眠。','有人在神龕旁留下麵包。'],
};
// one localised omen line per verb (fr/zh); en falls back to the god's own text
export const OMEN_I18N = {
  fr: { parch:'Le ruisseau s’amincit et sent la rouille.', poison:'Un voile pâle flotte sur l’eau à l’aube.', flood:'De la pluie en une saison qui n’en a pas.', raid:'De la fumée sur la crête, que nul n’a allumée.', arm:'Quelqu’un a vendu du fer sur la route.', betray:'Une porte trouvée ouverte. Nul ne l’a ouverte.', mend:'Un enfant qui était malade ne l’est plus.', shelter:'Le vent tourne à la palissade et la contourne.', respite:'Une semaine passe, et rien n’arrive. C’est insoutenable.', bargain:'Un présent, non signé, et lourd.', exact:'Le grain que vous n’aviez pas compté a disparu.', reveal:'Un rêve, très clair, de qui est en colère.' },
  zh: { parch:'溪流細瘦，帶著鏽味。', poison:'黎明時分，水面浮著一層蒼白之膜。', flood:'不該有雨的季節下起了雨。', raid:'山脊上有煙，卻無人點燃。', arm:'有人在路上販賣鐵器。', betray:'一道門被發現敞開，卻無人開啟。', mend:'一個曾病倒的孩子痊癒了。', shelter:'風在柵欄前轉向，繞行而去。', respite:'一週過去，什麼都沒發生。令人難以忍受。', bargain:'一份禮物，未署名，沉甸甸的。', exact:'你未曾清點的穀物不見了。', reveal:'一個夢，極其清晰，關於誰在動怒。' },
};

// engine.js pushes English log lines; localise them at display via this map.
export const LOG_I18N = {
  'You draw the cover over the well and clear the silt.': { fr: 'Vous tirez le couvercle sur le puits et ôtez la vase.', zh: '你為井蓋上蓋子，清去淤泥。' },
  'The fields give what they have.': { fr: 'Les champs donnent ce qu’ils ont.', zh: '田地獻出它們所有。' },
  'You raise the palisade another course.': { fr: 'Vous élevez la palissade d’un rang.', zh: '你將柵欄再加高一層。' },
  'You let the village sleep.': { fr: 'Vous laissez le village dormir.', zh: '你讓村莊安睡。' },
  'You burn an offering at the shrine.': { fr: 'Vous brûlez une offrande au sanctuaire.', zh: '你在神龕前焚燒供品。' },
  'You settle what was written against your name.': { fr: 'Vous réglez ce qui était inscrit contre votre nom.', zh: '你了結了記在你名下的債。' },
  'You owe nothing. The gesture is wasted.': { fr: 'Vous ne devez rien. Le geste est vain.', zh: '你並無欠債，此舉徒然。' },
  'You take the shrine apart for its stone and its stores.': { fr: 'Vous démontez le sanctuaire pour sa pierre et ses vivres.', zh: '你拆下神龕，取其石與其存糧。' },
  'There is not enough to eat.': { fr: 'Il n’y a pas assez à manger.', zh: '食物不足以果腹。' },
  'The water runs out.': { fr: 'L’eau vient à manquer.', zh: '水耗盡了。' },
};
export function localizeLog(lang, text) {
  if (lang === 'en') return text;
  const e = LOG_I18N[text];
  return (e && e[lang]) || text;
}

// map place-names per language (site markers + cartouche + village)
export const MAP_I18N = {
  en: { well:'The Thirsting Well', ridge:'The Grudge Ridge', refuge:"Oss's Refuge", shrine:'The Ledger Shrine', village:'Aldermere' },
  fr: { well:'Le Puits Assoiffé', ridge:'La Crête des Rancunes', refuge:'Le Refuge d’Oss', shrine:'Le Sanctuaire du Registre', village:'Aldermère' },
  zh: { well:'渴之井', ridge:'宿怨之脊', refuge:'奧斯的庇護所', shrine:'帳冊神龕', village:'奧德米爾' },
};

export function t(lang, key, vars) {
  let s = (D[lang] && D[lang][key]) ?? D.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', vars[k]);
  return s;
}

/**
 * Local-SEO content for the Greater Toronto Area (GTA): city hubs, category copy, FAQs and guides.
 * Shared by the server-rendered HTML snapshot (seo.ts) and the JSON API the React pages read,
 * so Google and visitors always see the same text.
 */

export interface Faq { q: string; a: string }
export interface GtaArea {
  name: string;
  slug: string;
  region: string; // e.g. "Peel Region"
  neighbourhoods: string[];
  nearby: string[]; // slugs
}

const area = (name: string, region: string, neighbourhoods: string[], nearby: string[]): GtaArea => ({
  name,
  slug: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  region,
  neighbourhoods,
  nearby,
});

export const GTA_AREAS: GtaArea[] = [
  area('Toronto', 'the City of Toronto', ['Downtown', 'East York', 'The Beaches', 'Leslieville', 'Liberty Village', 'Danforth'], ['scarborough', 'north-york', 'etobicoke', 'mississauga', 'markham']),
  area('Scarborough', 'the City of Toronto', ['Agincourt', 'Malvern', 'Guildwood', 'Bendale', 'Birch Cliff'], ['toronto', 'markham', 'pickering', 'ajax', 'north-york']),
  area('North York', 'the City of Toronto', ['Willowdale', 'Don Mills', 'York Mills', 'Downsview', 'Bayview Village'], ['toronto', 'vaughan', 'markham', 'richmond-hill', 'etobicoke']),
  area('Etobicoke', 'the City of Toronto', ['Rexdale', 'Islington', 'Mimico', 'Humber Bay', 'Kingsway'], ['toronto', 'mississauga', 'brampton', 'north-york', 'vaughan']),
  area('Mississauga', 'Peel Region', ['Port Credit', 'Streetsville', 'Erin Mills', 'Meadowvale', 'Malton', 'Cooksville', 'Clarkson'], ['brampton', 'oakville', 'etobicoke', 'toronto', 'milton']),
  area('Brampton', 'Peel Region', ['Bramalea', 'Heart Lake', 'Springdale', 'Castlemore', 'Mount Pleasant', 'Downtown Brampton'], ['mississauga', 'vaughan', 'caledon', 'etobicoke', 'milton']),
  area('Markham', 'York Region', ['Unionville', 'Milliken', 'Cornell', 'Markham Village', 'Angus Glen'], ['scarborough', 'richmond-hill', 'vaughan', 'pickering', 'toronto']),
  area('Vaughan', 'York Region', ['Woodbridge', 'Maple', 'Concord', 'Kleinburg', 'Thornhill'], ['brampton', 'richmond-hill', 'north-york', 'markham', 'etobicoke']),
  area('Richmond Hill', 'York Region', ['Oak Ridges', 'Langstaff', 'Mill Pond', 'Bayview Hill'], ['markham', 'vaughan', 'aurora', 'newmarket', 'north-york']),
  area('Oakville', 'Halton Region', ['Bronte', 'Glen Abbey', 'Old Oakville', 'Clearview', 'Uptown Core'], ['mississauga', 'burlington', 'milton', 'etobicoke', 'toronto']),
  area('Burlington', 'Halton Region', ['Aldershot', 'Appleby', 'Tyandaga', 'Downtown Burlington'], ['oakville', 'milton', 'mississauga', 'halton-hills']),
  area('Milton', 'Halton Region', ['Old Milton', 'Beaty', 'Willmott', 'Scott'], ['oakville', 'mississauga', 'brampton', 'burlington', 'halton-hills']),
  area('Pickering', 'Durham Region', ['Liverpool', 'Bay Ridges', 'Rouge Park', 'Dunbarton'], ['ajax', 'scarborough', 'whitby', 'markham', 'toronto']),
  area('Ajax', 'Durham Region', ['Pickering Village', 'Northwest Ajax', 'Westney Heights', 'Central West'], ['pickering', 'whitby', 'oshawa', 'scarborough', 'markham']),
  area('Whitby', 'Durham Region', ['Brooklin', 'Port Whitby', 'Williamsburg', 'Downtown Whitby'], ['ajax', 'oshawa', 'pickering', 'scarborough', 'markham']),
  area('Oshawa', 'Durham Region', ['Taunton', 'Windfields', 'Samac', 'Eastdale'], ['whitby', 'ajax', 'pickering', 'markham', 'scarborough']),
  area('Newmarket', 'York Region', ['Stonehaven', 'Glenway', 'Armitage', 'Downtown Newmarket'], ['aurora', 'richmond-hill', 'markham', 'vaughan', 'north-york']),
  area('Aurora', 'York Region', ['Aurora Heights', 'Bayview Wellington', 'Aurora Grove', 'Downtown Aurora'], ['newmarket', 'richmond-hill', 'vaughan', 'markham', 'north-york']),
  area('Caledon', 'Peel Region', ['Bolton', 'Caledon East', 'Inglewood', 'Mayfield West'], ['brampton', 'vaughan', 'mississauga', 'halton-hills', 'milton']),
  area('Halton Hills', 'Halton Region', ['Georgetown', 'Acton', 'Glen Williams'], ['milton', 'brampton', 'caledon', 'burlington', 'mississauga']),
];

export const gtaBySlug = new Map(GTA_AREAS.map((a) => [a.slug, a]));

// ---- category copy ------------------------------------------------------------------------

interface CatCopy { match: RegExp; noun: string; buyTips: string[]; sellTips: string[] }
const CAT_COPY: CatCopy[] = [
  { match: /electron|phone|mobile|computer|laptop/, noun: 'electronics', buyTips: ['Ask for the model number and check it on the manufacturer’s site.', 'Test the device in person — power it on, check the screen, battery and ports.', 'Ask whether the original box, charger and receipt are included.'], sellTips: ['Factory-reset the device and sign out of all accounts before meeting.', 'Photograph the screen powered on, plus any scratches, so buyers know what to expect.', 'Mention the model, storage size and battery health in the title.'] },
  { match: /furnit|sofa|couch|bed|table/, noun: 'furniture', buyTips: ['Measure the item and your doorways, hallway and elevator before you go.', 'Bring a vehicle or confirm delivery — large pieces rarely fit in a car.', 'Check frames, legs and upholstery for damage, odours or pet hair.'], sellTips: ['Photograph from several angles in good daylight and show the dimensions.', 'Say whether pickup only or local delivery is possible.', 'Clean the piece first; a quick wipe-down often raises the final price.'] },
  { match: /house|home|kitchen|appliance|garden/, noun: 'household items', buyTips: ['Test appliances before paying — plug them in and run a cycle if you can.', 'Ask how old the item is and why it is being sold.', 'Bundle several small items from one seller to save a trip.'], sellTips: ['Group small items into bundles — they sell faster than single pieces.', 'List the brand, size and age in the title.', 'Be upfront about wear; honest listings avoid wasted trips.'] },
  { match: /fashion|cloth|wear|shoe|jewel|bag/, noun: 'fashion and clothing', buyTips: ['Ask for measurements, not just the size on the label.', 'Request photos of tags, seams and any wear.', 'For jewellery and watches, ask about authenticity and receipts.'], sellTips: ['Lay clothes flat or hang them in daylight and photograph the tag.', 'Include measurements and the fabric.', 'Wash or steam items before the photos.'] },
  { match: /sport|fitness|outdoor|bike|cycl/, noun: 'sports and fitness gear', buyTips: ['Check bikes and equipment for frame damage, worn parts and safe moving joints.', 'Ask how often the gear was used and how it was stored.', 'Try it out if you can before buying.'], sellTips: ['Photograph serial numbers and any wear on bikes and equipment.', 'List the size, brand and year.', 'Mention if accessories such as helmets, weights or bags are included.'] },
];
const CAT_FALLBACK: CatCopy = { match: /./, noun: 'items', buyTips: ['Meet in a busy, well-lit public place.', 'Inspect the item before you pay.', 'Ask questions in chat first so you only travel for items that fit your needs.'], sellTips: ['Use clear, bright photos from several angles.', 'Write an honest description with the brand, size and condition.', 'Reply quickly — fast replies close more sales.'] };
export const catCopy = (slug: string, name: string): CatCopy => CAT_COPY.find((c) => c.match.test(`${slug} ${name}`.toLowerCase())) ?? CAT_FALLBACK;

// ---- page content --------------------------------------------------------------------------

export interface PageContent {
  heading: string;
  intro: string[];
  areas: string[];
  tips: { title: string; items: string[] }[];
  faq: Faq[];
  nearby: { name: string; slug: string }[];
}

const CITY_INTROS: Record<string, string> = {
  toronto: 'Toronto is Canada’s largest city and the centre of the GTA, so there is always something for sale nearby — from downtown condo furniture to electronics in the east end.',
  mississauga: 'Mississauga sits west of Toronto in Peel Region and has one of the largest South Asian communities in the GTA, which makes local buying and selling especially active.',
  brampton: 'Brampton is one of the fastest-growing cities in the GTA and a hub for families, newcomers and small businesses — all of whom buy and sell household goods every day.',
  markham: 'Markham, in York Region, is known for its diverse communities and busy neighbourhoods like Unionville and Milliken, with steady demand for electronics and furniture.',
  vaughan: 'Vaughan, in York Region, combines growing suburbs such as Woodbridge and Maple with a lot of new housing — and plenty of furniture and household items changing hands.',
  scarborough: 'Scarborough, in Toronto’s east end, is a large, diverse community where people trade everything from phones and appliances to furniture and clothing.',
};

export function cityContent(a: GtaArea | { name: string; slug: string; region?: string; neighbourhoods?: string[]; nearby?: string[] }, cat: { name: string; slug: string } | null, cats: { name: string; slug: string }[]): PageContent {
  const g = gtaBySlug.get(a.slug);
  const hoods = g?.neighbourhoods ?? a.neighbourhoods ?? [];
  const region = g?.region ?? a.region ?? 'the Greater Toronto Area';
  const c = cat ? catCopy(cat.slug, cat.name) : null;
  const what = cat ? `${cat.name.toLowerCase()}` : 'items';
  const lead = CITY_INTROS[a.slug] ?? `${a.name} is part of ${region} in the Greater Toronto Area, and neighbours like to buy and sell locally to save on shipping and meet face to face.`;
  const intro = cat
    ? [
        `Looking for ${what} for sale in ${a.name}? SaudaGo lists ads from local sellers in ${a.name}${hoods.length ? `, including ${hoods.slice(0, 4).join(', ')}` : ''}. Browse photos, compare prices in Canadian dollars and message the seller directly to arrange a pickup.`,
        `${lead} Searching ${what} in ${a.name} on SaudaGo means you only see nearby listings, so there is no long drive for a quick pickup.`,
      ]
    : [
        `${lead} SaudaGo is a free local marketplace where ${a.name} buyers and sellers connect directly — browse electronics, household items, furniture, fashion and sports gear posted near you.`,
        `${hoods.length ? `Sellers list from across ${a.name}, including ${hoods.join(', ')}. ` : ''}Every seller on SaudaGo is approved by our team, and you chat with them in the app before you meet.`,
      ];
  const tips = c
    ? [{ title: `Tips for buying ${what} in ${a.name}`, items: c.buyTips }, { title: `Tips for selling ${what} in ${a.name}`, items: c.sellTips }]
    : [{ title: `Safe meetups in ${a.name}`, items: ['Meet in a busy, well-lit public place — many police services in the GTA also offer safe exchange zones.', 'Bring a friend for large purchases and tell someone where you are going.', 'Inspect the item before you pay, and prefer to pay when you collect it.'] }];
  const faq: Faq[] = [
    { q: `How do I buy ${what} in ${a.name} on SaudaGo?`, a: `Browse the listings below, open one you like and use the chat box to message the seller. Agree on a time and a public place in ${a.name} to meet, check the item and pay when you collect it.` },
    { q: `How do I sell ${what} in ${a.name}?`, a: `Create an account, request seller approval from your dashboard and post your ad with clear photos and a fair price. Our team reviews each seller and listing before it appears.` },
    { q: `Is it safe to meet sellers in ${a.name}?`, a: `Choose a busy public place, such as a shopping centre or a community centre parking lot, and bring a friend for larger items. Never send money before seeing the item.` },
    { q: `Which areas of ${a.name} can I find deals in?`, a: `${hoods.length ? `Sellers post from across ${a.name}, including ${hoods.join(', ')}, and from nearby cities in ${region}.` : `Sellers post from across ${a.name} and from nearby cities in ${region}.`} Use the location filter to narrow results to your area.` },
    { q: 'Do prices include tax?', a: 'Sellers list prices in Canadian dollars. Private sales usually do not charge sales tax, but always confirm the final price with the seller before meeting.' },
  ];
  const near = (g?.nearby ?? a.nearby ?? []).map((s) => gtaBySlug.get(s)).filter(Boolean).map((x) => ({ name: x!.name, slug: x!.slug }));
  return { heading: cat ? `${cat.name} for sale in ${a.name}` : `Buy & sell in ${a.name}`, intro, areas: hoods, tips, faq, nearby: near.length ? near : GTA_AREAS.slice(0, 5).filter((x) => x.slug !== a.slug).map((x) => ({ name: x.name, slug: x.slug })) };
}

export function categoryContent(cat: { name: string; slug: string }): PageContent {
  const c = catCopy(cat.slug, cat.name);
  const what = cat.name.toLowerCase();
  return {
    heading: `${cat.name} for sale in the GTA`,
    intro: [
      `Browse ${what} for sale from sellers across the Greater Toronto Area on SaudaGo — Toronto, Mississauga, Brampton, Markham, Vaughan and beyond. Compare prices in Canadian dollars, check the photos and message the seller to arrange a local pickup.`,
      `Buying second-hand ${c.noun} locally saves money and avoids shipping delays. Every seller on SaudaGo is approved by our team before they can post.`,
    ],
    areas: [],
    tips: [{ title: `Buying ${c.noun}`, items: c.buyTips }, { title: `Selling ${c.noun}`, items: c.sellTips }],
    faq: [
      { q: `Where can I find ${what} for sale near me?`, a: `Use the city links below to see ${what} listed in your part of the GTA, or filter by location on the listings page.` },
      { q: `How do I sell ${what} on SaudaGo?`, a: 'Create an account, request seller approval from your dashboard and post your ad with clear photos, a fair price and your location.' },
      { q: `How do I avoid scams when buying ${what}?`, a: 'Meet in a public place, inspect the item before paying, avoid sending deposits or e-transfers in advance and keep conversations inside the app.' },
    ],
    nearby: GTA_AREAS.slice(0, 8).map((x) => ({ name: x.name, slug: x.slug })),
  };
}

// ---- guides ---------------------------------------------------------------------------------

export interface Guide {
  slug: string;
  title: string;
  description: string;
  updated: string; // ISO date
  sections: { h: string; p: string[] }[];
  faq: Faq[];
}

export const GUIDES: Guide[] = [
  {
    slug: 'buy-and-sell-safely-in-the-gta',
    title: 'How to Buy and Sell Safely in the GTA',
    description: 'Practical safety tips for meeting buyers and sellers across Toronto, Mississauga, Brampton and the rest of the GTA — meetups, payments and red flags.',
    updated: '2026-11-23',
    sections: [
      { h: 'Meet in a busy public place', p: ['Choose a well-lit, busy location such as a shopping centre, a coffee shop or a community-centre car park. Many police services across the GTA also offer safe exchange zones, so check your local service’s website for the nearest one.', 'Meet during the day if you can, and tell a friend or family member where you are going. For larger items, bring someone with you.'] },
      { h: 'Inspect before you pay', p: ['Always look at the item in person before handing over money. Power on electronics, try zips and drawers, and check for damage that photos may hide. If something does not match the listing, it is fine to walk away.'] },
      { h: 'Keep payments simple', p: ['Prefer paying in person when you collect the item. Be careful with deposits and advance e-transfers — if a seller insists on payment before you can see the item, treat it as a warning sign.', 'Sellers should confirm the payment has arrived in their account before handing over valuable items.'] },
      { h: 'Keep chats inside SaudaGo', p: ['Use the in-app chat so there is a record of what was agreed. Be cautious of anyone who asks to move quickly to another app, sends links, or asks for personal information such as passwords or one-time codes.'] },
      { h: 'Red flags to watch for', p: ['Prices far below market value, pressure to decide quickly, refusal to meet in person, and stories that change between messages are all signs to slow down. You can report a listing or a user from the page itself and our team will review it.'] },
    ],
    faq: [
      { q: 'Where should I meet a buyer in the GTA?', a: 'Pick a busy public place such as a shopping centre or a safe exchange zone offered by your local police service.' },
      { q: 'Should I send a deposit to hold an item?', a: 'It is safest not to. Pay when you collect the item and have inspected it.' },
      { q: 'How do I report a suspicious listing?', a: 'Use the Report button on the listing or the seller’s profile and our team will review it.' },
    ],
  },
  {
    slug: 'sell-used-furniture-in-toronto-and-the-gta',
    title: 'How to Sell Used Furniture Fast in Toronto and the GTA',
    description: 'A step-by-step guide to photographing, pricing and delivering used furniture in Toronto, Mississauga, Brampton and across the GTA.',
    updated: '2026-11-23',
    sections: [
      { h: 'Clean and stage the piece', p: ['A quick clean makes furniture look newer and helps it sell for more. Vacuum upholstery, wipe wood and metal, and remove clutter around the item before you take photos.'] },
      { h: 'Take photos that sell', p: ['Use natural daylight and take photos from the front, side and back, plus close-ups of any wear. Include one photo with a tape measure or a note of the dimensions so buyers know it will fit.'] },
      { h: 'Price it fairly', p: ['Search for similar items on SaudaGo to see what they sell for. Furniture often sells for roughly a third to half of its original price depending on age and condition, so start slightly above your target if you are open to offers.'] },
      { h: 'Plan pickup and delivery', p: ['Most buyers will collect, so say whether the item is on the ground floor, in an elevator building or upstairs. If you can help with local delivery in your part of the GTA, mention the areas you cover — it can widen your pool of buyers.'] },
      { h: 'Write a clear title and description', p: ['Include the type, material, colour, size and condition, for example “Solid wood dining table, seats 6, 180 × 90 cm”. Mention pets or smoke in the home honestly; it saves wasted trips.'] },
    ],
    faq: [
      { q: 'How much should I ask for used furniture?', a: 'Compare similar listings and consider age and condition. Many sellers list slightly above their target price to leave room for offers.' },
      { q: 'Can I offer delivery?', a: 'Yes. State the areas you can deliver to in your ad, and agree on any delivery fee with the buyer in chat.' },
    ],
  },
  {
    slug: 'sell-electronics-online-in-toronto-checklist',
    title: 'Selling Phones, Laptops and Electronics in Toronto: A Checklist',
    description: 'What to do before selling a phone, laptop or other electronics locally in Toronto and the GTA — resetting devices, photos, pricing and safe handovers.',
    updated: '2026-11-23',
    sections: [
      { h: 'Back up and reset', p: ['Back up your data, sign out of your accounts and factory-reset the device before you meet the buyer. For phones and laptops, make sure any “find my device” or activation lock is switched off so the new owner can set it up.'] },
      { h: 'Gather the details', p: ['Note the model, storage size, colour, battery health and purchase year. List what is included — charger, box, case or receipt — because buyers search by these details.'] },
      { h: 'Photograph it powered on', p: ['Show the screen on, the ports and any scratches. Honest photos reduce questions and arguments at the meetup.'] },
      { h: 'Price against similar listings', p: ['Look up comparable models on SaudaGo and check how condition and storage affect the price. Newer models lose value quickly, so list them while they are still in demand.'] },
      { h: 'Hand over safely', p: ['Meet in a public place, let the buyer test the device, and accept payment before you hand it over. Never share verification codes or passwords.'] },
    ],
    faq: [
      { q: 'What should I do before selling a phone?', a: 'Back up your data, sign out of all accounts, turn off any activation lock and perform a factory reset.' },
      { q: 'Should I include the original box?', a: 'Yes if you have it — buyers often pay a little more for the box, charger and receipt.' },
    ],
  },
  {
    slug: 'desi-marketplace-in-the-gta',
    title: 'Buying and Selling South Asian and Desi Goods in the GTA',
    description: 'Where to find and sell Desi clothing, wedding items, kitchenware, electronics and household goods locally across Mississauga, Brampton, Scarborough and the GTA.',
    updated: '2026-11-23',
    sections: [
      { h: 'A marketplace made for the community', p: ['The GTA is home to one of the largest South Asian communities in Canada, with strong neighbourhoods in Mississauga, Brampton, Scarborough, Markham and beyond. SaudaGo was built so people in these communities can trade directly with each other, close to home.'] },
      { h: 'Popular categories', p: ['Shoppers commonly look for fashion such as shalwar kameez, sarees, lehengas and jewellery, plus kitchenware, home décor, furniture and electronics. Listing the item type clearly in the title, including common local names, helps buyers find it.'] },
      { h: 'Selling occasion wear and wedding items', p: ['Outfits and décor that were worn or used once often have strong resale value. Photograph the whole outfit and the details, include measurements, and say whether alterations are possible.'] },
      { h: 'Trade with people nearby', p: ['Searching by city or area keeps pickups short. Use the city pages — for example Mississauga, Brampton or Scarborough — to see what has just been posted near you.'] },
    ],
    faq: [
      { q: 'Can I sell Desi clothing and wedding items on SaudaGo?', a: 'Yes. Post clear photos, measurements and the condition, and buyers across the GTA can message you.' },
      { q: 'How do I find sellers near me?', a: 'Use the city pages or the location filter to browse ads in your area.' },
    ],
  },
  {
    slug: 'newcomers-guide-to-buying-second-hand-in-canada',
    title: 'Newcomers’ Guide to Buying Second-Hand Household Items in the GTA',
    description: 'Setting up a home in the GTA on a budget: what to buy used, what to buy new, and how to find good local deals on furniture, appliances and electronics.',
    updated: '2026-11-23',
    sections: [
      { h: 'Start with the essentials', p: ['A bed, a table and chairs, basic kitchen items and a way to stay connected cover most of what you need in the first weeks. Second-hand furniture and kitchenware are often in excellent condition and cost a fraction of new prices.'] },
      { h: 'What to buy used and what to buy new', p: ['Furniture, kitchenware, bikes and many electronics are good second-hand buys. Mattresses, pillows and anything you cannot clean or inspect properly are usually better bought new. Always test appliances before you pay.'] },
      { h: 'Plan the move', p: ['Check dimensions, stairs and elevators before you buy, and arrange a vehicle or local delivery. Buying several items from one seller can save a trip and sometimes a little money.'] },
      { h: 'Budget in Canadian dollars', p: ['Prices on SaudaGo are listed in CAD. Compare a few similar listings before you make an offer, and ask politely if the price is flexible.'] },
      { h: 'Stay safe', p: ['Meet in public places, inspect everything before paying and keep your conversations in the app. See our safety guide for more tips.'] },
    ],
    faq: [
      { q: 'What should newcomers buy second-hand?', a: 'Furniture, kitchenware, small appliances and bikes are all good second-hand buys; test anything electrical before you pay.' },
      { q: 'Can I negotiate prices?', a: 'Often yes. Many sellers expect offers, so ask politely and be ready to pick up quickly.' },
    ],
  },
  {
    slug: 'how-to-price-a-used-item-in-canada',
    title: 'How to Price a Used Item in Canada',
    description: 'Simple rules for pricing second-hand items in Canadian dollars so they sell quickly in Toronto and the GTA without leaving money on the table.',
    updated: '2026-11-23',
    sections: [
      { h: 'Research similar listings', p: ['Search SaudaGo for the same or a similar item and note the asking prices and how long listings stay up. Items that have been listed for weeks are usually priced too high.'] },
      { h: 'Factor in age and condition', p: ['A rough starting point is a percentage of the new price: lightly used items often sell for around half, and older or heavily used items for much less. Adjust for brand, rarity and how well it has been looked after.'] },
      { h: 'Leave room to negotiate', p: ['If you are happy to take offers, list slightly above your target and note “or best offer”. If you want a quick, firm sale, price fairly and say the price is firm.'] },
      { h: 'Refresh stale listings', p: ['If an ad gets views but no messages, improve the photos or lower the price a little. Updating the title and description can also help.'] },
    ],
    faq: [
      { q: 'How low should I price used items?', a: 'Compare similar listings; lightly used items often sell for about half the new price, and older items for less.' },
      { q: 'Should I put “negotiable” in my ad?', a: 'If you are open to offers, say so. If not, state that the price is firm.' },
    ],
  },
];
export const guideBySlug = new Map(GUIDES.map((g) => [g.slug, g]));

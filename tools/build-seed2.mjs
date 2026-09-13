/** Adds recipes + SOP steps for the extended menu, writes the final seed. */
import fs from 'node:fs'

const S = JSON.parse(fs.readFileSync('tools/.cache/stage1.json', 'utf8'))
const { bySku, dishByName } = S
const I = (sku) => { if (!bySku[sku]) throw new Error('sku ' + sku); return bySku[sku] }
const D = (n) => { if (!dishByName[n]) throw new Error('dish ' + n); return dishByName[n] }

let rid = S.recipes.length
const add = (ownerType, ownerId, yieldQty, lines, steps = [], plating, prepMins) => {
  rid++
  S.recipes.push({
    id: `rcp_${rid}`, ownerType, ownerId, version: 1, yieldQty,
    lines: lines.map(([sku, qty, w], i) => ({
      id: `rl_${rid}_${i}`, itemId: I(sku), qty, wastagePct: w ?? 0, optional: false,
    })),
    steps: steps.map((t, i) => ({
      id: `sp_${rid}_${i}`, seq: i + 1,
      instruction: Array.isArray(t) ? t[0] : t,
      minutes: Array.isArray(t) ? t[1] : undefined,
      ccp: Array.isArray(t) ? t[2] : undefined,
    })),
    platingNotes: plating, standardPrepMins: prepMins,
    updatedAt: '2026-05-01T09:00:00.000Z', updatedBy: 'stf_head', active: true,
  })
}

/* -------- prep recipes (yield in base units) -------- */
add('PREP', I('PRP-004'), 1000, [
  ['CRD-001', 600], ['PRP-003', 90], ['SPC-003', 40], ['SPC-001', 25],
  ['SPC-007', 10], ['SPC-004', 10], ['OIL-001', 120], ['SLT-001', 25], ['VEG-018', 4],
], [
  ['Hang the curd in muslin for 30 minutes until thick — watery marinade will not cling.', 30],
  ['Whisk in ginger-garlic paste, chilli, garam masala, turmeric and salt.', 5],
  ['Crush kasuri methi between the palms and fold in with oil and lemon juice.', 3],
  ['Label with date and hold below 5 °C. Discard after 3 days.', 2, 'Hold ≤5 °C, 3-day shelf life'],
], 'Batch of 1 litre marinates roughly 20 portions.', 40)

add('PREP', I('PRP-005'), 1000, [['VEG-001', 2800, 0.02], ['OIL-001', 400]], [
  ['Slice onions to an even 2 mm — uneven slices burn before the rest colours.', 15],
  ['Fry at 160 °C in batches until pale gold; they darken after draining.', 25, 'Oil at 160 °C — above 180 °C turns them bitter'],
  ['Drain on rack, cool fully, store airtight.', 10],
], 'Yields about 1 kg birista from 2.8 kg raw onion.', 50)

add('PREP', I('PRP-006'), 1000, [
  ['VEG-007', 500, 0.05], ['VEG-010', 300, 0.05], ['VEG-006', 80], ['VEG-005', 40],
  ['SLT-001', 20], ['VEG-018', 6], ['SUG-001', 20],
], [
  ['Pick leaves, wash in three changes of water, spin dry.', 12, 'Wash in potable water only'],
  ['Grind with chilli, garlic, salt, sugar and lemon using ice water, not tap water.', 8],
  ['Portion into 200 g tubs; make fresh daily.', 5, '3-day shelf life, hold ≤5 °C'],
], 'Colour holds for a day; anything greying goes in the bin.', 25)

add('PREP', I('PRP-007'), 1000, [
  ['SAU-001', 150], ['SAU-003', 200], ['SAU-004', 120], ['SAU-002', 60], ['FLR-003', 70],
  ['VEG-005', 60], ['VEG-004', 40], ['OIL-001', 100], ['SUG-001', 40],
], [
  ['Sweat chopped garlic and ginger in hot oil without colouring.', 4],
  ['Add sauces, vinegar and sugar; simmer 6 minutes.', 6],
  ['Slurry the corn flour in cold water and thicken to a coating consistency.', 4],
  ['Cool rapidly to below 5 °C within 90 minutes.', 5, 'Cool to ≤5 °C within 90 min'],
], 'One litre dresses about 11 portions.', 20)

/* -------- new dish recipes -------- */
const R = {
  'Paneer Tikka': [[['PNR-001', 180], ['CRD-001', 60], ['PRP-004', 45], ['VEG-008', 40, 0.02],
    ['VEG-001', 40, 0.02], ['PRP-003', 8], ['SPC-008', 2], ['BTR-001', 10], ['VEG-018', 0.25],
    ['PRP-006', 25]], [
    ['Cut paneer into 40 g cubes; anything smaller dries out on the skewer.', 5],
    ['Marinate with tandoori marinade and hung curd for at least 45 minutes.', 45, 'Marinate ≤5 °C'],
    ['Skewer alternating with capsicum and onion petals.', 5],
    ['Cook in tandoor 4–5 minutes, basting once with butter.', 5, 'Core temp ≥74 °C'],
    ['Finish with chaat masala and lemon off the heat.', 1],
  ], 'Six cubes per skewer on a bed of onion rings, green chutney on the side.', 18],

  'Chicken Tikka': [[['CHK-001', 200, 0.02], ['CRD-001', 50], ['PRP-004', 50], ['PRP-003', 10],
    ['SPC-008', 2], ['BTR-001', 10], ['VEG-001', 30, 0.02], ['VEG-018', 0.25], ['PRP-006', 25]], [
    ['Trim and cube chicken to 35 g; pat completely dry.', 6],
    ['First marination: ginger-garlic, lemon, salt — 20 minutes.', 20],
    ['Second marination in tandoori marinade — minimum 2 hours, ideally overnight.', 120, 'Hold ≤5 °C'],
    ['Tandoor 6–7 minutes, baste with butter, rest 2 minutes.', 8, 'Core temp ≥75 °C'],
    ['Dust with chaat masala, squeeze lemon, serve immediately.', 1],
  ], 'Five pieces, sliced onion, lemon wedge, chutney ramekin.', 20],

  'Veg Manchurian': [[['VEG-014', 90, 0.03], ['VEG-015', 40, 0.02], ['VEG-019', 15], ['FLR-003', 35],
    ['FLR-002', 25], ['OIL-001', 40], ['PRP-007', 90], ['SAU-001', 8], ['VEG-006', 5], ['PRP-003', 8]], [
    ['Grate cabbage and carrot, salt lightly, squeeze out all water.', 8],
    ['Bind with corn flour and maida — no egg, no water.', 4],
    ['Roll into 25 g balls and fry at 170 °C until deep gold.', 6, 'Oil 170 °C'],
    ['Toss in manchurian base only at the pass so the balls stay crisp.', 2],
  ], 'Eight balls, sauce napped not drowned, spring onion on top.', 14],

  'Chilli Chicken': [[['CHK-001', 180, 0.02], ['FLR-003', 30], ['FLR-002', 15], ['VEG-008', 50, 0.02],
    ['VEG-001', 50, 0.02], ['OIL-001', 45], ['SAU-001', 12], ['SAU-004', 15], ['SAU-003', 12],
    ['PRP-003', 10], ['VEG-019', 10]], [
    ['Cut chicken into 25 g strips, marinate in soy, pepper and corn flour for 20 minutes.', 20],
    ['Fry at 175 °C until just cooked; do not overload the basket.', 6, 'Core temp ≥75 °C'],
    ['Wok-toss peppers and onion on high flame for 90 seconds only.', 2],
    ['Add sauces, return chicken, toss and serve — total wok time under 4 minutes.', 3],
  ], 'Semi-dry, high gloss, spring onion greens scattered.', 15],

  'Gobi 65': [[['VEG-013', 200, 0.03], ['FLR-003', 35], ['FLR-002', 20], ['CRD-001', 25],
    ['SPC-003', 6], ['PRP-003', 8], ['OIL-001', 45], ['VEG-006', 4], ['SPC-008', 2]], [
    ['Blanch florets 2 minutes in salted water, then shock in ice water.', 6, 'Blanch then chill immediately'],
    ['Coat in curd, chilli, ginger-garlic and flours; rest 15 minutes.', 15],
    ['Double-fry: 160 °C to cook, 185 °C to crisp.', 7, 'Second fry 185 °C'],
    ['Toss with curry leaves and chaat masala.', 1],
  ], 'Piled high, lemon wedge, onion rings.', 12],

  'Kadai Paneer': [[['PNR-001', 160], ['VEG-008', 60, 0.02], ['VEG-001', 70, 0.02], ['VEG-002', 80],
    ['OIL-001', 25], ['BTR-001', 10], ['PRP-003', 10], ['SPC-005', 5], ['SPC-003', 4],
    ['SPC-001', 3], ['SPC-007', 2], ['VEG-007', 5], ['SPC-011', 2]], [
    ['Dry-roast coriander seeds and red chilli, crush coarse — kadai masala is never fine.', 6],
    ['Sear onion and capsicum batons on high heat, keep them crunchy.', 4],
    ['Add tomato, kadai masala, cook until oil separates.', 8, 'Cook until fat separates'],
    ['Fold paneer in at the end; overcooking turns it rubbery.', 3],
  ], 'Serve in a kadai, kasuri methi crushed over, ginger julienne.', 14],

  'Chicken Chettinad': [[['CHK-001', 210, 0.02], ['VEG-001', 80, 0.02], ['VEG-002', 60],
    ['DRY-001', 10], ['OIL-001', 30], ['PRP-003', 12], ['SPC-009', 4], ['SPC-005', 6],
    ['SPC-003', 5], ['SPC-004', 2], ['VEG-007', 5], ['SPC-011', 3]], [
    ['Roast the chettinad spices separately and grind with cashew — never use ready masala.', 10],
    ['Brown onions properly; pale onions give a thin gravy.', 8],
    ['Add chicken, sear, then the ground masala and tomato.', 6],
    ['Simmer covered 18 minutes until the gravy clings.', 18, 'Core temp ≥75 °C'],
  ], 'Thick clinging gravy, pepper-forward, curry leaf garnish.', 16],

  'Palak Paneer': [[['PNR-001', 140], ['VEG-017', 200, 0.05], ['VEG-001', 50, 0.02], ['VEG-002', 40],
    ['CRM-001', 20], ['BTR-001', 12], ['PRP-003', 10], ['SPC-006', 3], ['VEG-006', 5], ['SPC-001', 2]], [
    ['Blanch spinach 90 seconds, shock in ice water — this is what keeps it green.', 4, 'Shock immediately or colour is lost'],
    ['Purée with green chilli, do not over-blend.', 3],
    ['Temper cumin, onion, tomato; add purée last and cook under 5 minutes.', 6],
    ['Fold paneer and finish with cream off the flame.', 3],
  ], 'Bright green, not olive. Cream swirl, butter cube.', 13],

  'Prawn Masala': [[['PRW-001', 180, 0.03], ['VEG-001', 80, 0.02], ['VEG-002', 70], ['OIL-001', 30],
    ['PRP-003', 12], ['SPC-004', 2], ['SPC-003', 5], ['SPC-005', 6], ['SPC-001', 3],
    ['VEG-007', 5], ['CRD-001', 30]], [
    ['De-vein and rinse prawns; check every piece.', 10, 'Reject any prawn with soft shell or ammonia smell'],
    ['Build the onion-tomato masala fully before the prawns go in.', 12],
    ['Add prawns for the last 4 minutes only — longer and they toughen.', 4, 'Core temp ≥63 °C'],
    ['Rest 2 minutes off the heat before serving.', 2],
  ], 'Six prawns visible on top, coriander, lemon.', 16],

  'Garlic Naan': [[['FLR-002', 120], ['MLK-001', 30], ['CRD-001', 20], ['BTR-001', 12],
    ['VEG-005', 8, 0.05], ['SUG-001', 4], ['SLT-001', 2], ['VEG-007', 2]], [
    ['Knead a soft dough with milk and curd; rest covered 2 hours.', 120, 'Prove at room temperature, use within 6 hours'],
    ['Portion 130 g balls, press with chopped garlic and coriander.', 4],
    ['Slap onto the tandoor wall; 90 seconds is the whole cook.', 2, 'Tandoor ≥300 °C'],
    ['Brush with butter as it comes off.', 1],
  ], 'Butter side up, folded once, served hot.', 5],

  'Veg Pulao': [[['RIC-001', 130], ['VEG-015', 40, 0.02], ['VEG-016', 30, 0.03], ['VEG-003', 40, 0.03],
    ['VEG-001', 40, 0.02], ['GHE-001', 12], ['SPC-011', 3], ['SPC-006', 2], ['VEG-010', 4],
    ['SLT-001', 3], ['PRP-005', 8]], [
    ['Soak basmati 30 minutes, drain fully.', 30],
    ['Temper whole spices in ghee until fragrant, not dark.', 3],
    ['Add vegetables, rice and 1.5× water; cook covered on low.', 15, 'Do not stir after the water goes in'],
    ['Rest 10 minutes before fluffing with a fork.', 10],
  ], 'Grains separate, birista and mint on top.', 12],

  'Gajar Halwa': [[['VEG-015', 220, 0.02], ['MLK-001', 120], ['SUG-001', 55], ['GHE-001', 18],
    ['DRY-004', 35], ['DRY-001', 8], ['SPC-010', 1]], [
    ['Grate carrot fine; coarse grating never softens properly.', 12],
    ['Cook in milk on low until completely dry — this is the whole dish.', 40, 'Reduce fully, no free milk left'],
    ['Add sugar (it loosens again), then ghee, then khoya.', 12],
    ['Finish with cardamom and roasted cashew.', 3],
  ], 'Warm, ghee glistening, cashew on top.', 8],

  'Masala Chai': [[['BEV-001', 6], ['MLK-001', 140], ['SUG-001', 12], ['VEG-004', 3, 0.05], ['SPC-010', 0.5]], [
    ['Boil water with crushed ginger and cardamom for 2 minutes.', 2],
    ['Add tea, boil 1 minute, then milk and sugar.', 3],
    ['Bring to a rolling boil twice and strain.', 2, 'Serve above 65 °C'],
  ], 'Served in a glass, 180 ml fill.', 4],

  'Fresh Lime Soda': [[['VEG-018', 1], ['SUG-001', 18], ['BEV-003', 1], ['SLT-001', 1]], [
    ['Juice the lemon to order; pre-juiced lime turns bitter within an hour.', 1, 'Juice to order'],
    ['Build over ice with sugar syrup and salt.', 1],
    ['Top with chilled soda, do not stir more than twice.', 1],
  ], 'Tall glass, lemon wheel, straw.', 3],
}
for (const [name, [lines, steps, plating, mins]] of Object.entries(R)) {
  add('DISH', D(name), 1, lines, steps, plating, mins)
}

/* -------- SOP steps for the 12 carried-over dishes -------- */
const STEPS = {
  'Chicken Biryani': [[
    ['Marinate curry-cut chicken in curd, ginger-garlic and biryani masala for 2 hours.', 120, 'Hold ≤5 °C while marinating'],
    ['Par-boil soaked basmati to 70% with whole spices; drain the moment it bends.', 12],
    ['Layer chicken, rice, birista, mint and coriander. Two layers, never three.', 8],
    ['Seal and dum on low flame 25 minutes; do not open to check.', 25, 'Core temp ≥75 °C before service'],
    ['Rest 10 minutes, open at the table.', 10],
  ], 'Handi service. Rice grains separate, one leg piece visible per portion.', 45],
  'Mutton Biryani': [[
    ['Marinate mutton overnight with raw papaya, curd and masala.', 480, 'Hold ≤5 °C'],
    ['Pressure-cook mutton to 80% before layering — it will not cook through on dum.', 35, 'Core temp ≥78 °C'],
    ['Par-boil rice to 70%, layer with birista, mint and saffron milk.', 12],
    ['Dum 30 minutes on tawa over low flame.', 30],
    ['Rest 12 minutes before opening.', 12],
  ], 'Handi service, two pieces on the bone per portion.', 60],
  'Veg Biryani': [[
    ['Cut vegetables to even 20 mm; blanch the hard ones only.', 10],
    ['Sauté with biryani base masala until the raw smell goes.', 8],
    ['Layer with 70% cooked rice, birista, mint.', 8],
    ['Dum 20 minutes, rest 10.', 30],
  ], 'Handi service, vegetables visible in the top layer.', 35],
  'Butter Chicken': [[
    ['Cook tikka in the tandoor first; boiled chicken makes a flat curry.', 8, 'Core temp ≥75 °C'],
    ['Reduce makhani gravy on low, whisking, until it coats a spoon.', 12],
    ['Mount with butter and cream off the flame — boiling the cream splits it.', 3, 'Do not boil after cream'],
    ['Crush kasuri methi in and rest 2 minutes.', 2],
  ], 'Cream swirl, butter cube, coriander sprig.', 15],
  'Paneer Butter Masala': [[
    ['Warm the makhani gravy; do not let it catch on the base.', 8],
    ['Add paneer cubes for the last 3 minutes only.', 3],
    ['Finish with butter, cream and crushed kasuri methi.', 3, 'Do not boil after cream'],
  ], 'Cream swirl, julienned ginger.', 12],
  'Dal Makhani': [[
    ['Soak whole urad overnight; short soaking is the usual cause of a grainy dal.', 480],
    ['Pressure-cook 45 minutes until completely soft.', 45],
    ['Simmer on low with tomato, butter and cream for at least 3 hours, stirring often.', 180, 'Hold above 63 °C during service'],
    ['Finish each order with butter and a cream swirl.', 2],
  ], 'Served in a handi, butter cube on top.', 240],
  'Chicken 65': [[
    ['Marinate 25 g chicken cubes in curd, chilli and ginger-garlic for 1 hour.', 60, 'Hold ≤5 °C'],
    ['Coat in corn flour, fry at 170 °C.', 6, 'Core temp ≥75 °C'],
    ['Temper curry leaves and chilli, toss the fried chicken through.', 2],
  ], 'Dry, deep red, curry leaves on top.', 12],
  'Fish Curry': [[
    ['Check every fillet on arrival — firm flesh, clear eyes, no ammonia.', 5, 'Reject soft or off-smelling fish'],
    ['Build the tamarind-tomato base fully before the fish goes in.', 12],
    ['Slide fillets in and simmer 6 minutes without stirring.', 6, 'Core temp ≥63 °C'],
    ['Rest 5 minutes; the curry tastes better settled.', 5],
  ], 'Two fillets, gravy ladled over, curry leaf.', 20],
  'Jeera Rice': [[
    ['Soak basmati 30 minutes.', 30],
    ['Temper cumin in ghee until it crackles.', 2],
    ['Cook rice 1:1.5 with water, covered, on low.', 15],
    ['Rest 10 minutes, fluff with a fork.', 10],
  ], 'Grains separate, cumin visible.', 12],
  'Butter Naan': [[
    ['Knead soft dough, prove 2 hours covered.', 120, 'Use within 6 hours of proving'],
    ['Portion 130 g balls.', 3],
    ['Tandoor 90 seconds.', 2, 'Tandoor ≥300 °C'],
    ['Butter immediately off the heat.', 1],
  ], 'Folded once, butter side up.', 5],
  'Tandoori Roti': [[
    ['Knead wheat dough medium-stiff; rest 45 minutes.', 45],
    ['Portion 90 g, roll to 6 inches.', 2],
    ['Tandoor 60–75 seconds.', 2, 'Tandoor ≥300 °C'],
  ], 'Plain, no butter unless ordered.', 4],
  'Gulab Jamun (2 pc)': [[
    ['Make the dough soft; a tight dough gives a hard centre.', 10],
    ['Fry at 130 °C only — high heat browns the outside and leaves the middle raw.', 12, 'Oil at 130 °C, never above 150 °C'],
    ['Soak in warm syrup at least 2 hours before service.', 120, 'Syrup held above 60 °C'],
  ], 'Two pieces, warm syrup, pistachio.', 10],
}
for (const r of S.recipes) {
  if (r.ownerType !== 'DISH' || r.steps.length) continue
  const dish = S.dishes.find((d) => d.id === r.ownerId)
  const entry = dish ? STEPS[dish.name] : null
  if (!entry) continue
  const [steps, plating, mins] = entry
  r.steps = steps.map((t, i) => ({
    id: `sp_${r.id}_${i}`, seq: i + 1, instruction: t[0], minutes: t[1], ccp: t[2],
  }))
  r.platingNotes = plating
  r.standardPrepMins = mins
}

delete S.dishByName
delete S.bySku
fs.mkdirSync('src/core/seed', { recursive: true })
fs.writeFileSync('src/core/seed/masters.json', JSON.stringify(S))
const noRecipe = S.dishes.filter((d) => !S.recipes.some((r) => r.ownerType === 'DISH' && r.ownerId === d.id))
const prepNoRecipe = S.items.filter((i) => i.isPrep && !S.recipes.some((r) => r.ownerType === 'PREP' && r.ownerId === i.id))
console.log('final:', {
  categories: S.categories.length, items: S.items.length, dishes: S.dishes.length,
  recipes: S.recipes.length, staff: S.staff.length,
  dishesWithoutRecipe: noRecipe.map((d) => d.name),
  prepWithoutRecipe: prepNoRecipe.map((i) => i.name),
  kb: Math.round(fs.statSync('src/core/seed/masters.json').size / 1024),
})

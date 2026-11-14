import { describe, expect, it } from 'vitest';
import { runShadowCheck } from './shadowCheck';

// Independent fixtures inlined from origin/bibek/physics-fixtures; no checkout or fixture-path edits.
// Source: src/features/inspect/physics/fixtures/shadowFixtures.ts
const fixtures = [
  {"id":"valid-finite-light","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}},{"object":{"x":0.5833333333333334,"y":0.6},"shadow":{"x":0.5917653304008216,"y":0.7745423392970062}},{"object":{"x":0.7916666666666666,"y":0.7},"shadow":{"x":0.81886412026507,"y":0.8701783525157241}},{"object":{"x":0.9166666666666666,"y":0.5375},"shadow":{"x":0.9577210364681241,"y":0.7013069355078155}}],"expected":"consistent","reasonCode":"single_light_fits","lightPx":{"x":600,"y":-900}},
  {"id":"valid-finite-light-noisy","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16587395754679315,"y":0.563400318090745},"shadow":{"x":0.1336840160218451,"y":0.73011997945209}},{"object":{"x":0.37443100184302236,"y":0.65121293266473},"shadow":{"x":0.36337635025864057,"y":0.8240458116743576}},{"object":{"x":0.5833919284019062,"y":0.6000816638941933},"shadow":{"x":0.5905650681444511,"y":0.7748886129921467}},{"object":{"x":0.7919444609930603,"y":0.6996299603740135},"shadow":{"x":0.8197367795575241,"y":0.8695813645756714}},{"object":{"x":0.9164726807240746,"y":0.5365167707549062},"shadow":{"x":0.9589393166752279,"y":0.7020943694142411}}],"expected":"consistent","reasonCode":"single_light_fits","lightPx":{"x":600,"y":-900}},
  {"id":"outlier-extra-pair","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}},{"object":{"x":0.5833333333333334,"y":0.6},"shadow":{"x":0.5917653304008216,"y":0.7745423392970062}},{"object":{"x":0.7916666666666666,"y":0.7},"shadow":{"x":0.81886412026507,"y":0.8701783525157241}},{"object":{"x":0.9166666666666666,"y":0.5375},"shadow":{"x":0.9577210364681241,"y":0.7013069355078155}},{"object":{"x":0.6833333333333333,"y":0.8125},"shadow":{"x":0.6493758891659119,"y":0.979923137491916}}],"expected":"inconsistent","reasonCode":"outlier_pair","outlierIndex":5,"lightPx":{"x":600,"y":-900}},
  {"id":"parallel-light-at-infinity","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.20941918458237527,"y":0.7386923663973579}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.4177525179157086,"y":0.8261923663973579}},{"object":{"x":0.5833333333333334,"y":0.6},"shadow":{"x":0.6260858512490419,"y":0.7761923663973579}},{"object":{"x":0.7916666666666666,"y":0.7},"shadow":{"x":0.8344191845823752,"y":0.8761923663973579}},{"object":{"x":0.9166666666666666,"y":0.5375},"shadow":{"x":0.9594191845823752,"y":0.7136923663973579}}],"expected":"consistent","reasonCode":"light_at_infinity"},
  {"id":"two-lights","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.125,"y":0.625},"shadow":{"x":0.19818631923054483,"y":0.7770023553249777}},{"object":{"x":0.26666666666666666,"y":0.75},"shadow":{"x":0.3459266151925475,"y":0.8949877107180747}},{"object":{"x":0.4,"y":0.5625},"shadow":{"x":0.4944293354834477,"y":0.685354492593261}},{"object":{"x":0.6,"y":0.5625},"shadow":{"x":0.5055706645165523,"y":0.685354492593261}},{"object":{"x":0.7333333333333333,"y":0.75},"shadow":{"x":0.6540733848074525,"y":0.8949877107180747}},{"object":{"x":0.875,"y":0.625},"shadow":{"x":0.8018136807694551,"y":0.7770023553249777}}],"expected":"inconclusive","reasonCode":"multiple_lights"},
  {"id":"crop-zoom-of-valid","image":{"width":2000,"height":800},"pairs":[{"object":{"x":0.1,"y":0.375},"shadow":{"x":0.060227633843207624,"y":0.7105793394479355}},{"object":{"x":0.35,"y":0.55},"shadow":{"x":0.3352930934857066,"y":0.8980634541716119}},{"object":{"x":0.6,"y":0.45},"shadow":{"x":0.6101183964809859,"y":0.7990846785940124}},{"object":{"x":0.85,"y":0.65},"shadow":{"x":0.882636944318084,"y":0.9903567050314481}},{"object":{"x":1,"y":0.325},"shadow":{"x":1.049265243761749,"y":0.6526138710156312}}],"expected":"consistent","reasonCode":"single_light_fits","lightPx":{"x":1000,"y":-2400}},
  {"id":"duplicate-pair","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}}],"expected":"rejected","reasonCode":"duplicate_pair"},
  {"id":"near-zero-segment","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}},{"object":{"x":0.5833333333333334,"y":0.6},"shadow":{"x":0.5835833333333333,"y":0.60025}}],"expected":"rejected","reasonCode":"near_zero_segment"},
  {"id":"underconstrained-two-pairs","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}}],"expected":"rejected","reasonCode":"underconstrained"},
  {"id":"non-finite","image":{"width":1200,"height":800},"pairs":[{"object":{"x":0.16666666666666666,"y":0.5625},"shadow":{"x":0.13352302820267303,"y":0.7302896697239677}},{"object":{"x":0.375,"y":0.65},"shadow":{"x":0.3627442445714221,"y":0.824031727085806}},{"object":{"x":Number.NaN,"y":0.5},"shadow":{"x":0.5,"y":0.6}}],"expected":"rejected","reasonCode":"non_finite"}
];

describe('Bibek independent shadow acceptance fixtures', () => {
  for (const fixture of fixtures) {
    it(fixture.id + ' -> ' + fixture.expected, () => {
      const pairs = fixture.pairs.map((pair, i) => ({ ...pair, id: 'pair-' + i }));
      const result = runShadowCheck(pairs, 'synthetic-' + fixture.id, {
        imageSize: fixture.image,
        // Crop fixtures intentionally retain marks beyond the cropped image boundary.
        allowOffImagePoints: true,
      });
      // Rejection is an input outcome, represented using the existing CheckResult states.
      const actual = result.finding === 'not_applicable' || result.execution === 'failed'
        ? 'rejected' : result.finding;
      expect(actual).toBe(fixture.expected);
      if (fixture.expected === 'rejected') expect(result.reason).toBeTruthy();
      if (fixture.outlierIndex !== undefined) {
        expect(result.evidence.offendingPairIds).toContain('pair-' + fixture.outlierIndex);
      }
    });
  }
});

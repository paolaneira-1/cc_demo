# Subtext — Content Foundation

## Files in this directory

| File | Contents |
|------|----------|
| `fixtures.json` | 18 realistic text examples across 4 categories |
| `translation-dictionary.json` | 43 phrase → translation mappings with severity |
| `prompts.md` | 5 Claude system prompts (one per category + auto-detect) |
| `investor-archetypes.json` | 8 investor archetypes with descriptions and behaviours |
| `demo-script.md` | Demo video sequence, timing guide, and presenter notes |

## Category counts

- investor-email: 5 examples
- job-posting: 5 examples
- linkedin-post: 5 examples
- performance-review: 3 examples

## Translation dictionary breakdown

- investor-email phrases: 12
- job-posting phrases: 12
- performance-review phrases: 9
- linkedin-post phrases: 8
- **Total: 41 entries**

## Output schema (all prompts return this shape)

```typescript
type SubtextResult = {
  category: "investor-email" | "job-posting" | "linkedin-post" | "performance-review" | "other"
  bs_score: number          // 0-100
  one_liner: string         // max 15 words
  translations: {
    original: string
    decoded: string
    severity: "mild" | "spicy" | "nuclear"
  }[]
  archetype?: string        // investor-email only
  survival_probability?: number  // job-posting only, 0-100
  cringe_score?: number     // linkedin-post only, 0-10
  honest_rewrite: string
  the_reply_you_want: string
}
```

## Recommended demo order

1. `ie-001` — investor email (The Classic Pass) — anchor on "really rooting for you" → "goodbye"
2. `pr-001` — performance review — anchor on "executive presence" translation
3. `jp-003` — job posting — anchor on survival_probability: 24%
4. `lp-003` — LinkedIn post — anchor on cringe_score and honest_rewrite

Total runtime: ~2:30

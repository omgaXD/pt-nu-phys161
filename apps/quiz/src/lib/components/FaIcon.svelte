<script lang="ts" module>
  /**
   * Font Awesome 6 Free solid glyphs (CC BY 4.0), outlines as served by NU Moodle's fa-solid-900:
   * [advance width, path] in font units (512 per em, y up from the baseline).
   */
  const GLYPHS = {
    xmark: [
      384,
      'M343 297Q352 307 352 320Q352 333 343 343Q333 352 320 352Q307 352 297 343L192 237L87 343Q77 352 64 352Q51 352 41 343Q32 333 32 320Q32 307 41 297L147 192L41 87Q32 77 32 64Q32 51 41 41Q51 32 64 32Q77 32 87 41L192 147L297 41Q307 32 320 32Q333 32 343 41Q352 51 352 64Q352 77 343 87L237 192L343 297Z',
    ],
    'ellipsis-vertical': [
      128,
      'M64 88Q32 87 16 60Q0 32 16 4Q32 -23 64 -24Q96 -23 112 4Q128 32 112 60Q96 87 64 88ZM64 248Q32 247 16 220Q0 192 16 164Q32 137 64 136Q96 137 112 164Q128 192 112 220Q96 247 64 248ZM120 352Q119 384 92 400Q64 416 36 400Q9 384 8 352Q9 320 36 304Q64 288 92 304Q119 320 120 352Z',
    ],
    list: [
      512,
      'M40 400Q18 398 16 376V328Q18 306 40 304H88Q110 306 112 328V376Q110 398 88 400H40ZM192 384Q178 384 169 375Q160 366 160 352Q160 338 169 329Q178 320 192 320H480Q494 320 503 329Q512 338 512 352Q512 366 503 375Q494 384 480 384H192ZM192 224Q178 224 169 215Q160 206 160 192Q160 178 169 169Q178 160 192 160H480Q494 160 503 169Q512 178 512 192Q512 206 503 215Q494 224 480 224H192ZM192 64Q178 64 169 55Q160 46 160 32Q160 18 169 9Q178 0 192 0H480Q494 0 503 9Q512 18 512 32Q512 46 503 55Q494 64 480 64H192ZM16 216V168V216V168Q18 146 40 144H88Q110 146 112 168V216Q110 238 88 240H40Q18 238 16 216ZM40 80Q18 78 16 56V8Q18 -14 40 -16H88Q110 -14 112 8V56Q110 78 88 80H40Z',
    ],
    'chevron-left': [
      320,
      'M9 215Q0 205 0 192Q0 179 9 169L201 -23Q211 -32 224 -32Q237 -32 247 -23Q256 -13 256 0Q256 13 247 23L77 192L247 361Q256 371 256 384Q256 397 247 407Q237 416 224 416Q211 416 201 407L9 215Z',
    ],
    'chevron-right': [
      320,
      'M311 215Q320 205 320 192Q320 179 311 169L119 -23Q109 -32 96 -32Q83 -32 73 -23Q64 -13 64 0Q64 13 73 23L243 192L73 361Q64 371 64 384Q64 397 73 407Q83 416 96 416Q109 416 119 407L311 215Z',
    ],
    'chevron-down': [
      512,
      'M233 41Q243 32 256 32Q269 32 279 41L471 233Q480 243 480 256Q480 269 471 279Q461 288 448 288Q435 288 425 279L256 109L87 279Q77 288 64 288Q51 288 41 279Q32 269 32 256Q32 243 41 233L233 41Z',
    ],
  } as const satisfies Record<string, readonly [number, string]>;

  export type FaGlyph = keyof typeof GLYPHS;
</script>

<script lang="ts">
  interface Props {
    name: FaGlyph;
    /** `.fa-fw`: a 1.25em-wide box with the glyph centred; off, the box is the glyph's own width. */
    fixedWidth?: boolean;
  }

  let { name, fixedWidth = true }: Props = $props();

  const glyph = $derived(GLYPHS[name]);
  const boxWidth = $derived(fixedWidth ? 640 : glyph[0]);
</script>

<!-- An `<i class="icon fa fa-…">` at the current font size: 1em tall (line-height 1), the baseline 7/8
     down (FA's ascent/descent at line-height 1). Inline, `vertical-align: -0.125em` puts it on the text's. -->
<svg class="icon fa-icon" viewBox="0 0 {boxWidth} 512" style:width="{boxWidth / 512}em" aria-hidden="true"
  ><path transform="translate({(boxWidth - glyph[0]) / 2} 448) scale(1 -1)" d={glyph[1]} /></svg
>

<style>
  .fa-icon {
    display: inline-block;
    flex: none;
    height: 1em;
    margin: 0;
    fill: currentColor;
    stroke: none;
  }
</style>

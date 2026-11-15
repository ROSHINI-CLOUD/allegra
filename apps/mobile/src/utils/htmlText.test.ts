import { decodeHtmlEntities, removeNonContentBlocks, removeUntilStable, stripTags } from './htmlText';

describe('stripTags', () => {
  it('removes tags and keeps the words', () => {
    expect(stripTags('<p>Hello <b>world</b></p>')).toBe('Hello world');
    expect(stripTags('2 < 3, so rest')).toBe('2 < 3, so rest');
  });

  it('never leaves a complete tag behind', () => {
    for (const input of ['<scr<b>ipt>alert(1)</scr</b>ipt>', '<<i>b>x', '<<>>', '<a<b<c>>>']) {
      expect(stripTags(input)).not.toMatch(/<[^>]+>/);
    }
  });
});

describe('removeUntilStable', () => {
  it('repeats until the text stops changing', () => {
    expect(removeUntilStable('((a)(b))', /\([^()]*\)/g)).toBe('');
    expect(removeUntilStable('abc', /x/g)).toBe('abc');
  });
});

describe('removeNonContentBlocks', () => {
  it('drops script and style blocks even when the closing tag has spaces', () => {
    expect(removeNonContentBlocks('a<script>x()</script >b')).toBe('ab');
    expect(removeNonContentBlocks('a<script>x()</script\t\n bar>b<style>p{}</style junk>c')).toBe('abc');
    expect(removeNonContentBlocks('a<SCRIPT type="x">x()</SCRIPT\n>b<style>p{}</style  >c')).toBe('abc');
  });

  it('drops comments, including the --!> ending browsers also accept', () => {
    expect(removeNonContentBlocks('a<!-- note -->b<!-- odd --!>c')).toBe('abc');
  });

  it('keeps going when removing a block joins the text around it into another block', () => {
    expect(removeNonContentBlocks('<scr<!-- -->ipt>x()</script>y')).toBe('y');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry&#39;s &quot;hit&quot; &#x27;s&#x27; &lt;3 &gt; &apos;')).toBe('Tom & Jerry\'s "hit" \'s\' <3 > \'');
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes once: an escaped entity stays an entity', () => {
    expect(decodeHtmlEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
    expect(decodeHtmlEntities('&amp;#39;')).toBe('&#39;');
  });

  it('leaves unknown or impossible entities as written', () => {
    expect(decodeHtmlEntities('keep &unknown; and &#99999999; and &#xFFFFFFF;')).toBe('keep &unknown; and &#99999999; and &#xFFFFFFF;');
  });
});

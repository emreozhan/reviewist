import { describe, expect, it } from 'vitest';
import { sampleReview } from '../mock/sampleReview';
import { findDeclarationLine, guessFilePath, locateSymbol, topLevelTypeId } from './locate';
import { buildIndex, shortId, symbolTail } from './reviewIndex';
import { ownerTypeId, parseSymbolId } from './symbolId';

describe('sembol kimliği (@kök soneki)', () => {
  it('tip, üye ve kök sonekli kimlikleri ayrıştırır', () => {
    expect(parseSymbolId('com.x.Foo')).toEqual({ typeId: 'com.x.Foo', fqn: 'com.x.Foo', member: undefined });
    expect(parseSymbolId('com.x.Foo#bar(int)')).toEqual({ typeId: 'com.x.Foo', fqn: 'com.x.Foo', member: 'bar(int)' });
    expect(parseSymbolId('com.x.Foo@android/guava/src#bar(int)')).toEqual({
      typeId: 'com.x.Foo@android/guava/src',
      fqn: 'com.x.Foo',
      root: 'android/guava/src',
      member: 'bar(int)',
    });
    expect(parseSymbolId('com.x.Foo@guava-gwt/src-super')).toMatchObject({ fqn: 'com.x.Foo', root: 'guava-gwt/src-super', member: undefined });
  });

  it("'@' yalnız '#' öncesinde aranır (parametre anotasyonu kök sanılmaz)", () => {
    const p = parseSymbolId('com.x.Foo#bar(@Nullable Object)');
    expect(p).toMatchObject({ typeId: 'com.x.Foo', member: 'bar(@Nullable Object)' });
    expect(p.root).toBeUndefined();
  });

  it('sahip tip kimliği kök sonekini korur', () => {
    expect(ownerTypeId('com.x.Foo@android/guava/src#bar(int)')).toBe('com.x.Foo@android/guava/src');
    expect(ownerTypeId('com.x.Foo#bar(int)')).toBe('com.x.Foo');
  });

  it('kısa ad ve üst düzey tip kökü yok sayar (kökte nokta olsa bile)', () => {
    expect(shortId('com.x.Foo@android/guava/src#bar(int)')).toBe('Foo.bar()');
    expect(shortId('com.x.Foo@src.v2/main')).toBe('Foo');
    expect(shortId('com.x.Foo@r#count')).toBe('Foo.count');
    expect(topLevelTypeId('com.x.Outer.Inner@android/guava/src#m()')).toBe('com.x.Outer');
  });

  it('kökü olan diff dışı sembolün dosya yolu doğrudan kökten kurulur', () => {
    const index = buildIndex(sampleReview);
    expect(guessFilePath(index, 'com.google.common.base.Preconditions@android/guava/src#checkArgument(boolean)')).toBe(
      'android/guava/src/com/google/common/base/Preconditions.java',
    );
    expect(locateSymbol(index, 'com.google.common.base.Strings@guava/src#pad()')).toMatchObject({
      file: 'guava/src/com/google/common/base/Strings.java',
      guessed: true,
    });
    expect(symbolTail(index, 'com.google.common.base.Strings@guava/src#pad(int)')).toBe('pad()');
  });

  it('bildirim satırı aramasında kök soneki ad sanılmaz', () => {
    const lines = ['public final class Strings {', '  public static String pad(int n) {'];
    expect(findDeclarationLine(lines, 'com.x.Strings@android/guava/src')).toBe(1);
    expect(findDeclarationLine(lines, 'com.x.Strings@android/guava/src#pad(int)')).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { asEmojiPresentation, emojiByName, EMOJIS } from './emoji-data';

describe('asEmojiPresentation', () => {
  it('adds the variation selector to a lone text-default code point', () => {
    expect(asEmojiPresentation('❤')).toBe('❤️');
    expect(asEmojiPresentation('☺')).toBe('☺️');
  });

  it('leaves emoji that already have colour presentation or are sequences alone', () => {
    expect(asEmojiPresentation('\u{1F680}')).toBe('\u{1F680}');
    expect(asEmojiPresentation('❤️')).toBe('❤️');
    expect(asEmojiPresentation('\u{1F1EB}\u{1F1F7}')).toBe('\u{1F1EB}\u{1F1F7}');
  });
});

describe('EMOJIS', () => {
  it.each(['relaxed', 'skull_and_crossbones', 'heavy_heart_exclamation', 'heart', 'shamrock'])(
    'draws %s as a colour emoji',
    (name) => {
      expect(emojiByName(name)?.emoji?.endsWith('️')).toBe(true);
    },
  );

  it('has no lone text-default code point left without the selector', () => {
    const bare = EMOJIS.filter(
      (e) =>
        [...(e.emoji ?? '')].length === 1 &&
        /\p{Emoji}/u.test(e.emoji ?? '') &&
        !/\p{Emoji_Presentation}/u.test(e.emoji ?? ''),
    );
    expect(bare.map((e) => e.name)).toEqual([]);
  });
});

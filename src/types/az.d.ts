declare module 'az' {
  interface MorphParse {
    word: string;
    normalize(keepPartOfSpeech?: boolean): MorphParse | false;
  }

  interface MorphModule {
    (word: string): MorphParse[];
    init(path: string, callback: (error?: Error | null) => void): void;
  }

  const Az: { Morph: MorphModule };
  export default Az;
}

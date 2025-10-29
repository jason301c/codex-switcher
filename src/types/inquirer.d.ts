declare module "inquirer" {
  type Primitive = string | number | boolean | null | undefined;

  type ChoiceValue<T> = T extends Primitive ? T : unknown;

  export class Separator {
    constructor(line?: string);
  }

  export interface ListChoice<T> {
    name: string;
    value: ChoiceValue<T>;
    short?: string;
  }

  export type Choice<T> = ListChoice<T> | string | number | Separator;

  export interface Question<TAnswers> {
    type?: string;
    name: keyof TAnswers extends string ? keyof TAnswers : string;
    message?: string;
    default?: TAnswers[keyof TAnswers];
    loop?: boolean;
    pageSize?: number;
    validate?: (input: string) => boolean | string | Promise<boolean | string>;
    choices?: Array<Choice<TAnswers[keyof TAnswers]>>;
  }

  export type QuestionCollection<TAnswers> =
    | Question<TAnswers>
    | ReadonlyArray<Question<TAnswers>>;

  export interface PromptUi {
    close?: () => void;
    pause?: () => void;
    rl?: {
      pause?: () => void;
      close?: () => void;
    };
  }

  export interface PromptPromise<TAnswers> extends Promise<TAnswers> {
    ui?: PromptUi;
  }

  export interface PromptModule {
    <TAnswers>(
      questions: QuestionCollection<TAnswers>,
      answers?: Partial<TAnswers>
    ): PromptPromise<TAnswers>;
  }

  export const prompt: PromptModule;

  interface InquirerModule {
    prompt: PromptModule;
    Separator: typeof Separator;
  }

  const inquirer: InquirerModule;
  export default inquirer;
}

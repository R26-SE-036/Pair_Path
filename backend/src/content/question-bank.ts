/**
 * The exercise bank.
 *
 * ======================== WHAT THIS HAS TO COVER ========================
 * Code Coach detects fifteen error types across fourteen concept tags, listed
 * in code-coach/knowledge_base/code_coach_errors.json. Those tags are the
 * platform's shared vocabulary: Code Coach reports a finding under one, Study
 * Guider teaches a lesson for one, the gamification engine drills one. PairPath
 * is where a pair actually writes the code those errors occur in.
 *
 * It had three exercises tagged `arrays`, `loops`, `conditions`, `modulo`,
 * `indexing`, `bounds` and `logic` - free text matching nothing in any other
 * component. So a pair could hit an off-by-one, Code Coach could report
 * `loop_boundaries`, Study Guider could offer the loop-boundaries lesson, and
 * nothing connected the exercise to either. Every question below carries
 * canonical tags, and between them they cover all fourteen.
 * ========================================================================
 *
 * ============================ REVIEW PROMPTS ============================
 * `expected` is what a pair who did the exercise well would answer, and it is
 * not always `true`.
 *
 * The old prompts were ten per question, six of them identical filler across
 * all three ("Did we follow Java coding conventions?", "Did we add comments
 * where necessary?"), every one phrased so that yes is the good answer - and
 * scored as the count of yes answers. An instrument where ticking every box
 * scores full marks measures willingness to tick boxes. Mixing the polarity
 * means a student has to read each prompt, and the score reflects agreement
 * with what actually happened rather than agreeableness.
 *
 * The expected answers stay on the server. The API sends prompts only, for the
 * same reason it does not send referenceSolution.
 * ========================================================================
 */

export interface ReviewPrompt {
  prompt: string;
  /** What a pair who did this well would answer. */
  expected: boolean;
}

export interface BankQuestion {
  id: string;
  topicId: string;
  title: string;
  description: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  /** Canonical tags from the platform taxonomy. */
  conceptTags: string[];
  /** The Code Coach error types this exercise most often produces. */
  invitesErrors: string[];
  starterCode: string;
  referenceSolution: string;
  /**
   * Exactly what `referenceSolution` prints, byte for byte.
   *
   * Not hand-written: every value here was captured by running the reference
   * solution through the code runner, and a test re-runs all sixteen and
   * fails if any of them stops matching. A hand-typed expected output is a
   * second implementation of the exercise, and the one nobody runs.
   *
   * Withheld from the API for the same reason as referenceSolution - for
   * "print 10 down to 1" the expected output IS the answer.
   */
  expectedOutput: string;
  reviewQuestions: ReviewPrompt[];
}

export interface BankTopic {
  id: string;
  name: string;
  description: string;
}

/**
 * The fourteen tags, as a checkable list.
 *
 * Exported so a test can assert the bank covers all of them rather than
 * somebody counting by eye - which is how a concept ends up with a lesson, a
 * game and a detector, and no exercise to meet it in.
 */
export const PLATFORM_CONCEPT_TAGS = [
  'loop_boundaries',
  'conditional_logic',
  'array_indexing',
  'string_comparison',
  'loop_control',
  'control_flow',
  'switch_statements',
  'statement_structure',
  'assignment_logic',
  'boolean_logic',
  'immutable_strings',
  'arithmetic_operations',
  'loop_initialization',
  'loop_termination',
] as const;

export const TOPICS: BankTopic[] = [
  {
    id: 'loops-topic',
    name: 'Loops and Iteration',
    description: 'Where a loop starts, when it stops, and which way it moves.',
  },
  {
    id: 'arrays-topic',
    name: 'Arrays and Indexing',
    description: 'Valid indexes, length, and reading past the end.',
  },
  {
    id: 'conditions-topic',
    name: 'Conditions and Logic',
    description: 'Branching, boolean expressions, and the paths through a method.',
  },
  {
    id: 'strings-topic',
    name: 'Strings',
    description: 'Comparing text, and why string methods return rather than change.',
  },
  {
    id: 'expressions-topic',
    name: 'Expressions and Assignment',
    description: 'Assignment, arithmetic, and statements that are not what they look like.',
  },
];

export const QUESTIONS: BankQuestion[] = [
  // ── Loops and Iteration ────────────────────────────────────────────────
  {
    id: 'q-loop-boundaries-sum',
    topicId: 'loops-topic',
    title: 'Sum of Array Elements',
    description:
      'Add up every number in the array and print the total. Work out together what the ' +
      'last index you need to read is, and make sure the loop stops there.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_boundaries', 'array_indexing'],
    invitesErrors: ['OFF_BY_ONE_LOOP_BOUNDARY', 'ARRAY_LENGTH_INDEX_MISUSE'],
    starterCode: `public class ArraySum {
    public static void main(String[] args) {
        int[] numbers = {4, 8, 15, 16, 23, 42};
        int sum = 0;

        // TODO: add every element to sum, then print it

        System.out.println("Sum: " + sum);
    }
}`,
    referenceSolution: `public class ArraySum {
    public static void main(String[] args) {
        int[] numbers = {4, 8, 15, 16, 23, 42};
        int sum = 0;

        for (int i = 0; i < numbers.length; i++) {
            sum += numbers[i];
        }

        System.out.println("Sum: " + sum);
    }
}`,
    expectedOutput: "Sum: 108\n",
    reviewQuestions: [
      { prompt: 'Did the loop stop before numbers.length rather than at it?', expected: true },
      { prompt: 'Did we run the program and check the total by hand?', expected: true },
      { prompt: 'Did we hit an ArrayIndexOutOfBoundsException at any point?', expected: false },
      { prompt: 'Did the navigator say what the last valid index should be, before we ran it?', expected: true },
      { prompt: 'Did we change the loop condition by guessing until it worked?', expected: false },
      { prompt: 'Would our loop still be correct if the array had one more element?', expected: true },
    ],
  },
  {
    id: 'q-loop-control-countdown',
    topicId: 'loops-topic',
    title: 'Countdown',
    description:
      'Print the numbers from 10 down to 1, one per line. Decide together which direction ' +
      'the counter moves and which comparison keeps the loop going.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_control'],
    invitesErrors: ['LOOP_UPDATE_WRONG_DIRECTION'],
    starterCode: `public class Countdown {
    public static void main(String[] args) {
        // TODO: print 10, 9, 8, ... down to 1
    }
}`,
    referenceSolution: `public class Countdown {
    public static void main(String[] args) {
        for (int i = 10; i >= 1; i--) {
            System.out.println(i);
        }
    }
}`,
    expectedOutput: "10\n9\n8\n7\n6\n5\n4\n3\n2\n1\n",
    reviewQuestions: [
      { prompt: 'Does the counter move towards the value the condition tests against?', expected: true },
      { prompt: 'Did our first attempt run forever, or not run at all?', expected: false },
      { prompt: 'Did we check that both 10 and 1 are printed?', expected: true },
      { prompt: 'Did we discuss the update step before writing the loop?', expected: true },
      { prompt: 'Did we need to stop the program manually because it would not finish?', expected: false },
    ],
  },
  {
    id: 'q-loop-initialization-average',
    topicId: 'loops-topic',
    title: 'Average of Positive Numbers',
    description:
      'Print the average of only the positive numbers in the array. Watch what the counter ' +
      'and the accumulator start at, and what happens if nothing qualifies.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['loop_initialization', 'arithmetic_operations'],
    invitesErrors: ['CONSTANT_FALSE_LOOP_CONDITION', 'DIVISION_BY_ZERO_LITERAL'],
    starterCode: `public class PositiveAverage {
    public static void main(String[] args) {
        int[] values = {-3, 7, 0, 12, -8, 5};

        // TODO: average only the positive values, and handle "none of them"

    }
}`,
    referenceSolution: `public class PositiveAverage {
    public static void main(String[] args) {
        int[] values = {-3, 7, 0, 12, -8, 5};
        int total = 0;
        int count = 0;

        for (int i = 0; i < values.length; i++) {
            if (values[i] > 0) {
                total += values[i];
                count++;
            }
        }

        if (count == 0) {
            System.out.println("No positive values");
        } else {
            System.out.println("Average: " + ((double) total / count));
        }
    }
}`,
    expectedOutput: "Average: 8.0\n",
    reviewQuestions: [
      { prompt: 'Did we handle the case where no value is positive?', expected: true },
      { prompt: 'Did we divide before checking that the count was not zero?', expected: false },
      { prompt: 'Did we talk about what total and count should start at?', expected: true },
      { prompt: 'Did we test with an array where nothing qualifies?', expected: true },
      { prompt: 'Did integer division give us a result we did not expect?', expected: false },
    ],
  },
  {
    id: 'q-loop-termination-halving',
    topicId: 'loops-topic',
    title: 'Halve Until One',
    description:
      'Starting from 64, print the value and halve it until it reaches 1. Use a while loop, ' +
      'and make sure the thing the condition tests actually changes inside the loop.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_termination'],
    invitesErrors: ['WHILE_VARIABLE_NOT_UPDATED'],
    starterCode: `public class Halving {
    public static void main(String[] args) {
        int value = 64;

        // TODO: print value, then halve it, until it reaches 1

    }
}`,
    referenceSolution: `public class Halving {
    public static void main(String[] args) {
        int value = 64;

        while (value >= 1) {
            System.out.println(value);
            value = value / 2;
        }
    }
}`,
    expectedOutput: "64\n32\n16\n8\n4\n2\n1\n",
    reviewQuestions: [
      { prompt: 'Does the variable in the while condition change inside the loop?', expected: true },
      { prompt: 'Did the program have to be stopped by hand at any point?', expected: false },
      { prompt: 'Did we predict how many lines it would print before running it?', expected: true },
      { prompt: 'Did we check what the last value printed is?', expected: true },
    ],
  },

  // ── Arrays and Indexing ────────────────────────────────────────────────
  {
    id: 'q-array-indexing-last',
    topicId: 'arrays-topic',
    title: 'First and Last',
    description:
      'Print the first and the last element of the array, without hard-coding either ' +
      'position. Agree on what the last valid index is before you write it.',
    difficulty: 'BEGINNER',
    conceptTags: ['array_indexing'],
    invitesErrors: ['ARRAY_LENGTH_INDEX_MISUSE'],
    starterCode: `public class FirstAndLast {
    public static void main(String[] args) {
        String[] names = {"Ada", "Grace", "Alan", "Katherine"};

        // TODO: print the first and the last name

    }
}`,
    referenceSolution: `public class FirstAndLast {
    public static void main(String[] args) {
        String[] names = {"Ada", "Grace", "Alan", "Katherine"};

        System.out.println("First: " + names[0]);
        System.out.println("Last: " + names[names.length - 1]);
    }
}`,
    expectedOutput: "First: Ada\nLast: Katherine\n",
    reviewQuestions: [
      { prompt: 'Did we use names.length - 1 rather than names.length for the last element?', expected: true },
      { prompt: 'Did we write the number 3 anywhere instead of deriving it?', expected: false },
      { prompt: 'Would this still work if a fifth name were added?', expected: true },
      { prompt: 'Did we see an ArrayIndexOutOfBoundsException while working on it?', expected: false },
      { prompt: 'Did the navigator check the index expression before we ran it?', expected: true },
    ],
  },
  {
    id: 'q-array-indexing-reverse',
    topicId: 'arrays-topic',
    title: 'Print in Reverse',
    description:
      'Print the array backwards, from the last element to the first. Both ends of the ' +
      'loop are easy to get wrong by one — decide them together.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['array_indexing', 'loop_boundaries', 'loop_control'],
    invitesErrors: ['ARRAY_LENGTH_INDEX_MISUSE', 'OFF_BY_ONE_LOOP_BOUNDARY', 'LOOP_UPDATE_WRONG_DIRECTION'],
    starterCode: `public class ReversePrint {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};

        // TODO: print 5, 4, 3, 2, 1

    }
}`,
    referenceSolution: `public class ReversePrint {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};

        for (int i = numbers.length - 1; i >= 0; i--) {
            System.out.println(numbers[i]);
        }
    }
}`,
    expectedOutput: "5\n4\n3\n2\n1\n",
    reviewQuestions: [
      { prompt: 'Does the loop start at numbers.length - 1?', expected: true },
      { prompt: 'Does it stop at 0 rather than at 1?', expected: true },
      { prompt: 'Did we print every element exactly once?', expected: true },
      { prompt: 'Did we get an out-of-bounds error on the first run?', expected: false },
      { prompt: 'Did we swap roles at any point during this exercise?', expected: true },
    ],
  },
  {
    id: 'q-array-indexing-search',
    topicId: 'arrays-topic',
    title: 'Find the Position',
    description:
      'Print the index of the first occurrence of the target, or -1 if it is not there. ' +
      'Think about what should happen after you find it.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['array_indexing', 'control_flow'],
    invitesErrors: ['UNREACHABLE_CODE_AFTER_RETURN', 'ARRAY_LENGTH_INDEX_MISUSE'],
    starterCode: `public class FindPosition {
    public static int indexOf(int[] values, int target) {
        // TODO: return the index of target, or -1 if it is not present
        return -1;
    }

    public static void main(String[] args) {
        int[] values = {10, 20, 30, 40};
        System.out.println(indexOf(values, 30));
        System.out.println(indexOf(values, 99));
    }
}`,
    referenceSolution: `public class FindPosition {
    public static int indexOf(int[] values, int target) {
        for (int i = 0; i < values.length; i++) {
            if (values[i] == target) {
                return i;
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] values = {10, 20, 30, 40};
        System.out.println(indexOf(values, 30));
        System.out.println(indexOf(values, 99));
    }
}`,
    expectedOutput: "2\n-1\n",
    reviewQuestions: [
      { prompt: 'Does the method return -1 when the target is absent?', expected: true },
      { prompt: 'Is there any statement after a return that can never run?', expected: false },
      { prompt: 'Did we test both a value that is present and one that is not?', expected: true },
      { prompt: 'Does it return the FIRST match rather than the last?', expected: true },
      { prompt: 'Did we discuss where the return belongs before writing it?', expected: true },
    ],
  },

  // ── Conditions and Logic ───────────────────────────────────────────────
  {
    id: 'q-conditional-logic-grade',
    topicId: 'conditions-topic',
    title: 'Grade Boundaries',
    description:
      'Print a grade for the score: A for 80 and above, B for 70-79, C for 50-69, F below 50. ' +
      'Check that each branch is reachable and that none repeats another.',
    difficulty: 'BEGINNER',
    conceptTags: ['conditional_logic'],
    invitesErrors: ['DUPLICATE_IF_ELSE_CONDITION', 'INCORRECT_CONDITIONAL_OPERATOR'],
    starterCode: `public class Grades {
    public static void main(String[] args) {
        int score = 73;

        // TODO: print A, B, C or F for this score

    }
}`,
    referenceSolution: `public class Grades {
    public static void main(String[] args) {
        int score = 73;

        if (score >= 80) {
            System.out.println("A");
        } else if (score >= 70) {
            System.out.println("B");
        } else if (score >= 50) {
            System.out.println("C");
        } else {
            System.out.println("F");
        }
    }
}`,
    expectedOutput: "B\n",
    reviewQuestions: [
      { prompt: 'Is every branch reachable for some score?', expected: true },
      { prompt: 'Does the same condition appear twice in the chain?', expected: false },
      { prompt: 'Did we test the boundary values 80, 70 and 50?', expected: true },
      { prompt: 'Did we write = where we meant == at any point?', expected: false },
      { prompt: 'Did we check what happens at exactly 79?', expected: true },
    ],
  },
  {
    id: 'q-boolean-logic-range',
    topicId: 'conditions-topic',
    title: 'In Range',
    description:
      'Print whether the value falls between 10 and 20 inclusive. Read your condition ' +
      'aloud to each other and check it can actually be false.',
    difficulty: 'BEGINNER',
    conceptTags: ['boolean_logic'],
    invitesErrors: ['ALWAYS_TRUE_OR_CONDITION'],
    starterCode: `public class InRange {
    public static void main(String[] args) {
        int value = 25;

        // TODO: print true if value is between 10 and 20 inclusive, false otherwise

    }
}`,
    referenceSolution: `public class InRange {
    public static void main(String[] args) {
        int value = 25;

        boolean inRange = value >= 10 && value <= 20;
        System.out.println(inRange);
    }
}`,
    expectedOutput: "false\n",
    reviewQuestions: [
      { prompt: 'Did we use && rather than || to join the two comparisons?', expected: true },
      { prompt: 'Is there a value of the variable that makes the condition false?', expected: true },
      { prompt: 'Did we test a value below 10, one inside, and one above 20?', expected: true },
      { prompt: 'Did our first version print true for every value we tried?', expected: false },
    ],
  },
  {
    id: 'q-control-flow-classify',
    topicId: 'conditions-topic',
    title: 'Classify a Number',
    description:
      'Return "negative", "zero" or "positive" for the given number. Every path through ' +
      'the method has to return something, and nothing after a return can run.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['control_flow'],
    invitesErrors: ['UNREACHABLE_CODE_AFTER_RETURN'],
    starterCode: `public class Classify {
    public static String classify(int n) {
        // TODO: return "negative", "zero" or "positive"
        return "";
    }

    public static void main(String[] args) {
        System.out.println(classify(-5));
        System.out.println(classify(0));
        System.out.println(classify(7));
    }
}`,
    referenceSolution: `public class Classify {
    public static String classify(int n) {
        if (n < 0) {
            return "negative";
        }
        if (n == 0) {
            return "zero";
        }
        return "positive";
    }

    public static void main(String[] args) {
        System.out.println(classify(-5));
        System.out.println(classify(0));
        System.out.println(classify(7));
    }
}`,
    expectedOutput: "negative\nzero\npositive\n",
    reviewQuestions: [
      { prompt: 'Does every path through the method return a value?', expected: true },
      { prompt: 'Is there code after a return that can never be reached?', expected: false },
      { prompt: 'Did we test all three cases?', expected: true },
      { prompt: 'Did the compiler complain about a missing return statement?', expected: false },
    ],
  },
  {
    id: 'q-switch-statements-day',
    topicId: 'conditions-topic',
    title: 'Day Type',
    description:
      'Use a switch on the day name to print "weekend" or "weekday". Check what happens ' +
      'at the end of each case.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['switch_statements'],
    invitesErrors: ['MISSING_BREAK_IN_SWITCH'],
    starterCode: `public class DayType {
    public static void main(String[] args) {
        String day = "SATURDAY";

        // TODO: use a switch to print "weekend" or "weekday"

    }
}`,
    referenceSolution: `public class DayType {
    public static void main(String[] args) {
        String day = "SATURDAY";

        switch (day) {
            case "SATURDAY":
            case "SUNDAY":
                System.out.println("weekend");
                break;
            default:
                System.out.println("weekday");
                break;
        }
    }
}`,
    expectedOutput: "weekend\n",
    reviewQuestions: [
      { prompt: 'Does each case that produces output end with a break?', expected: true },
      { prompt: 'Did our first version print two lines for one day?', expected: false },
      { prompt: 'Did we deliberately let SATURDAY and SUNDAY share a body?', expected: true },
      { prompt: 'Did we test a weekday as well as a weekend day?', expected: true },
      { prompt: 'Is there a default case?', expected: true },
    ],
  },

  // ── Strings ────────────────────────────────────────────────────────────
  {
    id: 'q-string-comparison-password',
    topicId: 'strings-topic',
    title: 'Matching Answers',
    description:
      'Print whether the two answers match. They are equal as text — make sure your ' +
      'comparison says so.',
    difficulty: 'BEGINNER',
    conceptTags: ['string_comparison'],
    invitesErrors: ['STRING_EQUALITY_WITH_OPERATOR'],
    starterCode: `public class MatchingAnswers {
    public static void main(String[] args) {
        String expected = "hello";
        String given = new String("hello");

        // TODO: print true if the two strings are the same text

    }
}`,
    referenceSolution: `public class MatchingAnswers {
    public static void main(String[] args) {
        String expected = "hello";
        String given = new String("hello");

        System.out.println(expected.equals(given));
    }
}`,
    expectedOutput: "true\n",
    reviewQuestions: [
      { prompt: 'Did we compare the strings with .equals rather than ==?', expected: true },
      { prompt: 'Did our first attempt print false even though the text matched?', expected: false },
      { prompt: 'Could one of us explain what == actually compares for objects?', expected: true },
      { prompt: 'Did we test with two strings that differ as well?', expected: true },
    ],
  },
  {
    id: 'q-immutable-strings-trim',
    topicId: 'strings-topic',
    title: 'Clean Up the Input',
    description:
      'Strip the surrounding spaces from the input and print it in upper case. String ' +
      'methods hand you a new string — they do not change the one you called them on.',
    difficulty: 'BEGINNER',
    conceptTags: ['immutable_strings'],
    invitesErrors: ['IGNORED_STRING_METHOD_RESULT'],
    starterCode: `public class CleanInput {
    public static void main(String[] args) {
        String input = "   ada lovelace   ";

        // TODO: print the name trimmed and in upper case

        System.out.println("[" + input + "]");
    }
}`,
    referenceSolution: `public class CleanInput {
    public static void main(String[] args) {
        String input = "   ada lovelace   ";

        input = input.trim().toUpperCase();

        System.out.println("[" + input + "]");
    }
}`,
    expectedOutput: "[ADA LOVELACE]\n",
    reviewQuestions: [
      { prompt: 'Did we assign the result of trim() back to a variable?', expected: true },
      { prompt: 'Did calling input.trim() on its own change input?', expected: false },
      { prompt: 'Does the printed output have no spaces inside the brackets?', expected: true },
      { prompt: 'Did one of us explain why the first attempt printed the spaces?', expected: true },
    ],
  },

  // ── Expressions and Assignment ─────────────────────────────────────────
  {
    id: 'q-assignment-logic-swap',
    topicId: 'expressions-topic',
    title: 'Swap Two Values',
    description:
      'Swap the contents of the two variables and print them. You will need somewhere to ' +
      'put the first value before it is overwritten.',
    difficulty: 'BEGINNER',
    conceptTags: ['assignment_logic'],
    invitesErrors: ['SELF_ASSIGNMENT'],
    starterCode: `public class Swap {
    public static void main(String[] args) {
        int a = 3;
        int b = 8;

        // TODO: swap a and b

        System.out.println("a = " + a + ", b = " + b);
    }
}`,
    referenceSolution: `public class Swap {
    public static void main(String[] args) {
        int a = 3;
        int b = 8;

        int temporary = a;
        a = b;
        b = temporary;

        System.out.println("a = " + a + ", b = " + b);
    }
}`,
    expectedOutput: "a = 8, b = 3\n",
    reviewQuestions: [
      { prompt: 'Did we keep the first value somewhere before overwriting it?', expected: true },
      { prompt: 'Did either variable end up assigned to itself?', expected: false },
      { prompt: 'Did our first attempt leave both variables holding the same value?', expected: false },
      { prompt: 'Did we trace the three assignments out loud before running it?', expected: true },
    ],
  },
  {
    id: 'q-arithmetic-operations-average',
    topicId: 'expressions-topic',
    title: 'Split the Bill',
    description:
      'Divide the total between the given number of people and print the share. Consider ' +
      'what integer division does, and what happens when nobody is paying.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['arithmetic_operations'],
    invitesErrors: ['DIVISION_BY_ZERO_LITERAL'],
    starterCode: `public class SplitBill {
    public static void main(String[] args) {
        int total = 75;
        int people = 4;

        // TODO: print each person's share, and handle people == 0

    }
}`,
    referenceSolution: `public class SplitBill {
    public static void main(String[] args) {
        int total = 75;
        int people = 4;

        if (people == 0) {
            System.out.println("Nobody to split between");
        } else {
            System.out.println("Each pays: " + ((double) total / people));
        }
    }
}`,
    expectedOutput: "Each pays: 18.75\n",
    reviewQuestions: [
      { prompt: 'Did we check for zero people before dividing?', expected: true },
      { prompt: 'Did we get an ArithmeticException while testing?', expected: false },
      { prompt: 'Does 75 split four ways print 18.75 rather than 18?', expected: true },
      { prompt: 'Did we talk about integer division before writing the expression?', expected: true },
      { prompt: 'Did we test with people set to 0?', expected: true },
    ],
  },
  {
    id: 'q-statement-structure-report',
    topicId: 'expressions-topic',
    title: 'Only When Large',
    description:
      'Print a warning only when the value is above 100. Read the if statement carefully ' +
      'once it works — a stray semicolon changes what the body is.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['statement_structure'],
    invitesErrors: ['EMPTY_CONDITIONAL_BODY'],
    starterCode: `public class OnlyWhenLarge {
    public static void main(String[] args) {
        check(42);
        check(150);
    }

    static void check(int value) {
        // TODO: print "Too large" only when value is above 100

        System.out.println("Checked " + value);
    }
}`,
    referenceSolution: `public class OnlyWhenLarge {
    public static void main(String[] args) {
        check(42);
        check(150);
    }

    static void check(int value) {
        if (value > 100) {
            System.out.println("Too large");
        }

        System.out.println("Checked " + value);
    }
}`,
    expectedOutput: "Checked 42\nToo large\nChecked 150\n",
    reviewQuestions: [
      { prompt: 'Is there a semicolon immediately after the if condition?', expected: false },
      { prompt: 'Did we test a value above 100 and one below?', expected: true },
      { prompt: 'Did the warning print when it should not have?', expected: false },
      { prompt: 'Did the navigator read the if statement back before we moved on?', expected: true },
    ],
  },
];

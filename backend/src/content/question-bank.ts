/**
 * The exercise bank.
 *
 * ======================== WHAT THIS HAS TO COVER ========================
 * Code Coach detects thirty error types across fourteen concept tags, listed
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
   * Held to the reference solution by question-bank.run.spec.ts, which
   * compiles and runs every one with a real JDK and fails on any difference.
   * Without that an expected output is a second implementation of the
   * exercise - the one nobody runs - and a typo in it would tell a pair who
   * got it right that they had not.
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
  {
    id: 'methods-topic',
    name: 'Methods and Return Values',
    description: 'Splitting a program into methods that take values and hand one back.',
  },
  {
    id: 'nested-topic',
    name: 'Nested Loops and 2D Arrays',
    description: 'A loop inside a loop: rows and columns, tables and grids.',
  },
  {
    id: 'algorithms-topic',
    name: 'Searching and Sorting',
    description: 'Finding a value, putting values in order, and stopping at the right moment.',
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
  {
    id: 'q-loop-control-primes',
    topicId: 'loops-topic',
    title: 'Primes up to 30',
    description:
      'Print every prime number from 2 to 30, one per line. For each number, a loop inside the ' +
      'outer one looks for a divisor - and should stop looking the moment it finds one.',
    difficulty: 'ADVANCED',
    conceptTags: ['loop_control', 'boolean_logic'],
    invitesErrors: ['OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class Primes {
    public static void main(String[] args) {
        for (int n = 2; n <= 30; n++) {
            boolean prime = true;

            // TODO: look for a divisor of n from 2 upwards; if you find one,
            // n is not prime and there is no need to keep looking

            if (prime) {
                System.out.println(n);
            }
        }
    }
}`,
    referenceSolution: `public class Primes {
    public static void main(String[] args) {
        for (int n = 2; n <= 30; n++) {
            boolean prime = true;

            for (int d = 2; d * d <= n; d++) {
                if (n % d == 0) {
                    prime = false;
                    break;
                }
            }

            if (prime) {
                System.out.println(n);
            }
        }
    }
}`,
    expectedOutput: "2\n3\n5\n7\n11\n13\n17\n19\n23\n29\n",
    reviewQuestions: [
      { prompt: 'Does the inner loop stop as soon as a divisor is found?', expected: true },
      { prompt: 'Did our program list 1 or any even number above 2 as prime?', expected: false },
      { prompt: 'Did we explain to each other why checking up to the square root is enough?', expected: true },
      { prompt: 'Is the prime flag reset to true for every new number?', expected: true },
      { prompt: 'Did we start the divisor loop at 1?', expected: false },
    ],
  },
  {
    id: 'q-loop-termination-collatz',
    topicId: 'loops-topic',
    title: 'Collatz Steps',
    description:
      'For each starting number, count the steps to reach 1: halve an even number, and turn an ' +
      'odd one into 3n + 1. The while loop only ends if the number really changes every time round.',
    difficulty: 'ADVANCED',
    conceptTags: ['loop_termination', 'arithmetic_operations'],
    invitesErrors: ['WHILE_VARIABLE_NOT_UPDATED'],
    starterCode: `public class Collatz {
    public static void main(String[] args) {
        int[] starts = {6, 7, 27};

        for (int i = 0; i < starts.length; i++) {
            int n = starts[i];
            int steps = 0;

            // TODO: until n is 1, halve it when even or make it 3n + 1 when odd,
            // counting every step

            System.out.println(starts[i] + " takes " + steps + " steps");
        }
    }
}`,
    referenceSolution: `public class Collatz {
    public static void main(String[] args) {
        int[] starts = {6, 7, 27};

        for (int i = 0; i < starts.length; i++) {
            int n = starts[i];
            int steps = 0;

            while (n != 1) {
                if (n % 2 == 0) {
                    n = n / 2;
                } else {
                    n = 3 * n + 1;
                }
                steps++;
            }

            System.out.println(starts[i] + " takes " + steps + " steps");
        }
    }
}`,
    expectedOutput: "6 takes 8 steps\n7 takes 16 steps\n27 takes 111 steps\n",
    reviewQuestions: [
      { prompt: 'Does n change on every pass of the while loop?', expected: true },
      { prompt: 'Did we have to stop the program because it never finished?', expected: false },
      { prompt: 'Did we trace the steps for 6 by hand together before running it?', expected: true },
      { prompt: 'Is the step counter reset for each starting number?', expected: true },
      { prompt: 'Did we count the starting number itself as a step?', expected: false },
    ],
  },
  {
    id: 'q-loop-boundaries-count-passes',
    topicId: 'loops-topic',
    title: 'Count the Passes',
    description:
      'Count how many marks are 50 or more. The last mark in the array is a pass, so a loop ' +
      'that stops one element early gives the wrong count - check the last index it reads.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_boundaries'],
    invitesErrors: ['LOOP_SKIPS_LAST_ELEMENT', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class CountPasses {
    public static void main(String[] args) {
        int[] marks = {72, 45, 88, 39, 50};
        int passes = 0;

        // TODO: count every mark of 50 or more, the last one included

        System.out.println("Passes: " + passes + " of " + marks.length);
    }
}`,
    referenceSolution: `public class CountPasses {
    public static void main(String[] args) {
        int[] marks = {72, 45, 88, 39, 50};
        int passes = 0;

        for (int i = 0; i < marks.length; i++) {
            if (marks[i] >= 50) {
                passes++;
            }
        }

        System.out.println("Passes: " + passes + " of " + marks.length);
    }
}`,
    expectedOutput: "Passes: 3 of 5\n",
    reviewQuestions: [
      { prompt: 'Did the loop read the mark at index marks.length - 1?', expected: true },
      { prompt: 'Did we write marks.length - 1 in the loop condition?', expected: false },
      { prompt: 'Did we check the count against the marks by hand together?', expected: true },
      { prompt: 'Is a mark of exactly 50 counted as a pass?', expected: true },
      { prompt: 'Did we get 2 passes on our first run?', expected: false },
    ],
  },
  {
    id: 'q-loop-initialization-running-total',
    topicId: 'loops-topic',
    title: 'Running Total',
    description:
      'After each day, print the sales so far. Decide together where the total is created and ' +
      'set to zero - once, or every time round the loop.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_initialization'],
    invitesErrors: ['ACCUMULATOR_RESET_INSIDE_LOOP'],
    starterCode: `public class RunningTotal {
    public static void main(String[] args) {
        int[] sales = {120, 80, 150, 60};

        // TODO: after each day, print "After day N: " and the total so far

    }
}`,
    referenceSolution: `public class RunningTotal {
    public static void main(String[] args) {
        int[] sales = {120, 80, 150, 60};
        int total = 0;

        for (int i = 0; i < sales.length; i++) {
            total += sales[i];
            System.out.println("After day " + (i + 1) + ": " + total);
        }
    }
}`,
    expectedOutput: "After day 1: 120\nAfter day 2: 200\nAfter day 3: 350\nAfter day 4: 410\n",
    reviewQuestions: [
      { prompt: 'Is the total set to zero once, before the loop starts?', expected: true },
      { prompt: 'Did each line show one day of sales rather than the total so far?', expected: false },
      { prompt: 'Did we predict the last total together before running it?', expected: true },
      { prompt: 'Does the last line match the sum of all four days?', expected: true },
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
  {
    id: 'q-array-indexing-second-largest',
    topicId: 'arrays-topic',
    title: 'Second Largest',
    description:
      'Print the largest score and the second largest, in one pass through the array. The top ' +
      'score appears twice - the second largest is the next score below it, not the same one again.',
    difficulty: 'ADVANCED',
    conceptTags: ['array_indexing', 'conditional_logic'],
    invitesErrors: ['INCORRECT_CONDITIONAL_OPERATOR', 'DUPLICATE_IF_ELSE_CONDITION'],
    starterCode: `public class SecondLargest {
    public static void main(String[] args) {
        int[] scores = {12, 45, 7, 45, 30, 19};
        int largest = Integer.MIN_VALUE;
        int second = Integer.MIN_VALUE;

        // TODO: one loop that keeps both largest and second up to date

        System.out.println("Largest: " + largest);
        System.out.println("Second largest: " + second);
    }
}`,
    referenceSolution: `public class SecondLargest {
    public static void main(String[] args) {
        int[] scores = {12, 45, 7, 45, 30, 19};
        int largest = Integer.MIN_VALUE;
        int second = Integer.MIN_VALUE;

        for (int i = 0; i < scores.length; i++) {
            if (scores[i] > largest) {
                second = largest;
                largest = scores[i];
            } else if (scores[i] > second && scores[i] < largest) {
                second = scores[i];
            }
        }

        System.out.println("Largest: " + largest);
        System.out.println("Second largest: " + second);
    }
}`,
    expectedOutput: "Largest: 45\nSecond largest: 30\n",
    reviewQuestions: [
      { prompt: 'When a new largest arrives, does the old largest move down to second?', expected: true },
      { prompt: 'Did our program report 45 as the second largest at any point?', expected: false },
      { prompt: 'Did we walk through the array on paper together, value by value?', expected: true },
      { prompt: 'Did we sort the array to find the answer?', expected: false },
      { prompt: 'Would it still work if the largest score came last?', expected: true },
    ],
  },
  {
    id: 'q-array-indexing-rotate',
    topicId: 'arrays-topic',
    title: 'Rotate Right',
    description:
      'Move every element one place to the right, and the last one round to the front. Shift in ' +
      'the right direction, or each value overwrites the next before it has been moved.',
    difficulty: 'ADVANCED',
    conceptTags: ['array_indexing', 'loop_boundaries', 'assignment_logic'],
    invitesErrors: ['ARRAY_LENGTH_INDEX_MISUSE', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class RotateRight {
    public static void main(String[] args) {
        int[] values = {1, 2, 3, 4, 5};
        show("Before", values);

        // TODO: move every element one place right; the last one goes to the front

        show("After", values);
    }

    static void show(String label, int[] values) {
        String line = label + ":";
        for (int i = 0; i < values.length; i++) {
            line = line + " " + values[i];
        }
        System.out.println(line);
    }
}`,
    referenceSolution: `public class RotateRight {
    public static void main(String[] args) {
        int[] values = {1, 2, 3, 4, 5};
        show("Before", values);

        int last = values[values.length - 1];
        for (int i = values.length - 1; i > 0; i--) {
            values[i] = values[i - 1];
        }
        values[0] = last;

        show("After", values);
    }

    static void show(String label, int[] values) {
        String line = label + ":";
        for (int i = 0; i < values.length; i++) {
            line = line + " " + values[i];
        }
        System.out.println(line);
    }
}`,
    expectedOutput: "Before: 1 2 3 4 5\nAfter: 5 1 2 3 4\n",
    reviewQuestions: [
      { prompt: 'Did we save the last element before the loop overwrote it?', expected: true },
      { prompt: 'Did our first attempt fill the array with copies of one value?', expected: false },
      { prompt: 'Does the loop run from the end of the array towards the front?', expected: true },
      { prompt: 'Did the navigator check the first and last index the loop touches?', expected: true },
      { prompt: 'Did we read values[values.length] at any point?', expected: false },
    ],
  },
  {
    id: 'q-array-indexing-rising-days',
    topicId: 'arrays-topic',
    title: 'Rising Days',
    description:
      'Print every day on which the temperature went up the next day, and count them. Each ' +
      'comparison reads the NEXT element too, so decide together where the loop has to stop.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['array_indexing', 'loop_boundaries'],
    invitesErrors: ['INDEX_PLUS_ONE_OUT_OF_BOUNDS', 'LOOP_SKIPS_LAST_ELEMENT'],
    starterCode: `public class RisingDays {
    public static void main(String[] args) {
        int[] temps = {21, 23, 22, 25, 27, 26};
        int rises = 0;

        // TODO: compare each day with the next one; print "Day A to day B: up"
        // for every rise and count them. The last day has no next day.

        System.out.println("Rises: " + rises);
    }
}`,
    referenceSolution: `public class RisingDays {
    public static void main(String[] args) {
        int[] temps = {21, 23, 22, 25, 27, 26};
        int rises = 0;

        for (int i = 0; i < temps.length - 1; i++) {
            if (temps[i + 1] > temps[i]) {
                System.out.println("Day " + (i + 1) + " to day " + (i + 2) + ": up");
                rises++;
            }
        }

        System.out.println("Rises: " + rises);
    }
}`,
    expectedOutput: "Day 1 to day 2: up\nDay 3 to day 4: up\nDay 4 to day 5: up\nRises: 3\n",
    reviewQuestions: [
      { prompt: 'Does the loop stop before the last day, because it reads temps[i + 1]?', expected: true },
      { prompt: 'Did we see an ArrayIndexOutOfBoundsException on the last day?', expected: false },
      { prompt: 'Did the navigator name the last pair of days compared before we ran it?', expected: true },
      { prompt: 'Did we count the fall from 27 to 26 as a rise?', expected: false },
    ],
  },

  // ── Conditions and Logic ───────────────────────────────────────────────
  {
    id: 'q-conditional-logic-grade-v2',
    topicId: 'conditions-topic',
    title: 'Grade Boundaries',
    description:
      'Print a grade for each score, one per line: A for 80 and above, B for 70-79, C for 50-69, ' +
      'F below 50. The scores sit either side of every boundary - check that each branch is ' +
      'reachable and that none repeats another.',
    difficulty: 'BEGINNER',
    conceptTags: ['conditional_logic'],
    invitesErrors: ['DUPLICATE_IF_ELSE_CONDITION', 'INCORRECT_CONDITIONAL_OPERATOR'],
    starterCode: `public class Grades {
    public static void main(String[] args) {
        grade(95);
        grade(80);
        grade(79);
        grade(70);
        grade(69);
        grade(50);
        grade(49);
    }

    static void grade(int score) {
        // TODO: print A, B, C or F for this score

    }
}`,
    referenceSolution: `public class Grades {
    public static void main(String[] args) {
        grade(95);
        grade(80);
        grade(79);
        grade(70);
        grade(69);
        grade(50);
        grade(49);
    }

    static void grade(int score) {
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
    expectedOutput: "A\nA\nB\nB\nC\nC\nF\n",
    reviewQuestions: [
      { prompt: 'Is every branch reachable for some score?', expected: true },
      { prompt: 'Does the same condition appear twice in the chain?', expected: false },
      { prompt: 'Did each boundary score - 80, 70 and 50 - get the higher grade?', expected: true },
      { prompt: 'Did we write = where we meant == at any point?', expected: false },
      { prompt: 'Could we say why 79 is a B and not an A?', expected: true },
    ],
  },
  {
    id: 'q-boolean-logic-range-v2',
    topicId: 'conditions-topic',
    title: 'In Range',
    description:
      'Print whether each value falls between 10 and 20 inclusive, one result per line. Read ' +
      'your condition aloud to each other and check it can actually be false.',
    difficulty: 'BEGINNER',
    conceptTags: ['boolean_logic'],
    invitesErrors: ['ALWAYS_TRUE_OR_CONDITION'],
    starterCode: `public class InRange {
    public static void main(String[] args) {
        check(9);
        check(10);
        check(15);
        check(20);
        check(21);
    }

    static void check(int value) {
        // TODO: print true if value is between 10 and 20 inclusive, false otherwise

    }
}`,
    referenceSolution: `public class InRange {
    public static void main(String[] args) {
        check(9);
        check(10);
        check(15);
        check(20);
        check(21);
    }

    static void check(int value) {
        boolean inRange = value >= 10 && value <= 20;
        System.out.println(inRange);
    }
}`,
    expectedOutput: "false\ntrue\ntrue\ntrue\nfalse\n",
    reviewQuestions: [
      { prompt: 'Did we use && rather than || to join the two comparisons?', expected: true },
      { prompt: 'Is there a value that makes the condition false?', expected: true },
      { prompt: 'Did 10 and 20 themselves come out as in range?', expected: true },
      { prompt: 'Did our first version print true for every value?', expected: false },
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
    id: 'q-switch-statements-day-v2',
    topicId: 'conditions-topic',
    title: 'Day Type',
    description:
      'Use a switch on the day name to print "weekend" or "weekday" for each day, one per line. ' +
      'Check what happens at the end of each case - every day should print exactly one line.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['switch_statements'],
    invitesErrors: ['MISSING_BREAK_IN_SWITCH'],
    starterCode: `public class DayType {
    public static void main(String[] args) {
        classify("SATURDAY");
        classify("MONDAY");
        classify("SUNDAY");
        classify("FRIDAY");
    }

    static void classify(String day) {
        // TODO: use a switch to print "weekend" or "weekday"

    }
}`,
    referenceSolution: `public class DayType {
    public static void main(String[] args) {
        classify("SATURDAY");
        classify("MONDAY");
        classify("SUNDAY");
        classify("FRIDAY");
    }

    static void classify(String day) {
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
    expectedOutput: "weekend\nweekday\nweekend\nweekday\n",
    reviewQuestions: [
      { prompt: 'Does each case that produces output end with a break?', expected: true },
      { prompt: 'Did our first version print two lines for one day?', expected: false },
      { prompt: 'Did we deliberately let SATURDAY and SUNDAY share a body?', expected: true },
      { prompt: 'Did every day print exactly one line?', expected: true },
      { prompt: 'Is there a default case?', expected: true },
    ],
  },
  {
    id: 'q-boolean-logic-leap-years',
    topicId: 'conditions-topic',
    title: 'Leap Years',
    description:
      'Print whether each year is a leap year: divisible by 4, except century years, which must ' +
      'be divisible by 400. One condition, built from && and || - and which goes with which matters.',
    difficulty: 'ADVANCED',
    conceptTags: ['boolean_logic', 'conditional_logic'],
    invitesErrors: ['ALWAYS_FALSE_AND_CONDITION', 'ALWAYS_TRUE_OR_CONDITION'],
    starterCode: `public class LeapYears {
    public static void main(String[] args) {
        int[] years = {1900, 2000, 2023, 2024, 2100};

        for (int i = 0; i < years.length; i++) {
            int year = years[i];
            boolean leap = false; // TODO: the leap-year rule, as one boolean expression

            if (leap) {
                System.out.println(year + ": leap year");
            } else {
                System.out.println(year + ": not a leap year");
            }
        }
    }
}`,
    referenceSolution: `public class LeapYears {
    public static void main(String[] args) {
        int[] years = {1900, 2000, 2023, 2024, 2100};

        for (int i = 0; i < years.length; i++) {
            int year = years[i];
            boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;

            if (leap) {
                System.out.println(year + ": leap year");
            } else {
                System.out.println(year + ": not a leap year");
            }
        }
    }
}`,
    expectedOutput:
      "1900: not a leap year\n2000: leap year\n2023: not a leap year\n2024: leap year\n2100: not a leap year\n",
    reviewQuestions: [
      { prompt: 'Did we get 1900 and 2000 right, the two century years?', expected: true },
      { prompt: 'Did we write a condition like year % 4 == 0 && year % 4 != 0, which can never be true?', expected: false },
      { prompt: 'Did we use brackets to make clear which parts go together?', expected: true },
      { prompt: 'Did we agree on the rule in words before writing it in Java?', expected: true },
      { prompt: 'Did we need a separate if for every year in the list?', expected: false },
    ],
  },
  {
    id: 'q-control-flow-ticket-price',
    topicId: 'conditions-topic',
    title: 'Ticket Price',
    description:
      'Return the ticket price for an age and student status: under 5 is free, under 18 is 500, ' +
      '65 and over is 400, any other student is 600, and everyone else pays 1000. The order of ' +
      'the checks decides which rule wins.',
    difficulty: 'ADVANCED',
    conceptTags: ['control_flow', 'conditional_logic'],
    invitesErrors: ['DUPLICATE_IF_ELSE_CONDITION', 'UNREACHABLE_CODE_AFTER_RETURN'],
    starterCode: `public class TicketPrice {
    public static void main(String[] args) {
        show(3, false);
        show(12, true);
        show(20, true);
        show(20, false);
        show(70, false);
        show(70, true);
    }

    static int price(int age, boolean student) {
        // TODO: return the price - the first rule that applies wins
        return 0;
    }

    static void show(int age, boolean student) {
        System.out.println("Age " + age + (student ? " (student)" : "") + ": Rs. " + price(age, student));
    }
}`,
    referenceSolution: `public class TicketPrice {
    public static void main(String[] args) {
        show(3, false);
        show(12, true);
        show(20, true);
        show(20, false);
        show(70, false);
        show(70, true);
    }

    static int price(int age, boolean student) {
        if (age < 5) {
            return 0;
        }
        if (age < 18) {
            return 500;
        }
        if (age >= 65) {
            return 400;
        }
        if (student) {
            return 600;
        }
        return 1000;
    }

    static void show(int age, boolean student) {
        System.out.println("Age " + age + (student ? " (student)" : "") + ": Rs. " + price(age, student));
    }
}`,
    expectedOutput:
      "Age 3: Rs. 0\nAge 12 (student): Rs. 500\nAge 20 (student): Rs. 600\nAge 20: Rs. 1000\n" +
      "Age 70: Rs. 400\nAge 70 (student): Rs. 400\n",
    reviewQuestions: [
      { prompt: 'Does a 70-year-old student pay the senior price rather than the student price?', expected: true },
      { prompt: 'Did we put a statement after a return that could never run?', expected: false },
      { prompt: 'Did we discuss the order of the checks before writing them?', expected: true },
      { prompt: 'Does every path through price end in a return?', expected: true },
      { prompt: 'Did two of our conditions test exactly the same thing?', expected: false },
    ],
  },
  {
    id: 'q-conditional-logic-speeding-fine',
    topicId: 'conditions-topic',
    title: 'Speeding Fine',
    description:
      'Work out the penalty for each speed in a 60 zone. The bands overlap - 35 over is also ' +
      'more than 15 over - so the order you test them in decides which branch can ever run.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['conditional_logic'],
    invitesErrors: ['UNREACHABLE_ELSE_IF_ORDER', 'DUPLICATE_IF_ELSE_CONDITION'],
    starterCode: `public class SpeedingFine {
    static String penalty(int speed, int limit) {
        int over = speed - limit;

        // TODO: more than 30 over: "licence suspended"; more than 15 over: "fine 200";
        // any amount over: "fine 50"; otherwise "no fine"
        return "";
    }

    public static void main(String[] args) {
        int[] speeds = {55, 72, 80, 95};
        for (int i = 0; i < speeds.length; i++) {
            System.out.println(speeds[i] + " in a 60 zone: " + penalty(speeds[i], 60));
        }
    }
}`,
    referenceSolution: `public class SpeedingFine {
    static String penalty(int speed, int limit) {
        int over = speed - limit;

        if (over > 30) {
            return "licence suspended";
        } else if (over > 15) {
            return "fine 200";
        } else if (over > 0) {
            return "fine 50";
        } else {
            return "no fine";
        }
    }

    public static void main(String[] args) {
        int[] speeds = {55, 72, 80, 95};
        for (int i = 0; i < speeds.length; i++) {
            System.out.println(speeds[i] + " in a 60 zone: " + penalty(speeds[i], 60));
        }
    }
}`,
    expectedOutput:
      "55 in a 60 zone: no fine\n72 in a 60 zone: fine 50\n80 in a 60 zone: fine 200\n95 in a 60 zone: licence suspended\n",
    reviewQuestions: [
      { prompt: 'Is the largest band tested first?', expected: true },
      { prompt: 'Did 95 come out as "fine 50" at any point?', expected: false },
      { prompt: 'Did we pick one speed per band and agree its answer before running it?', expected: true },
      { prompt: 'Can every branch of our if-else chain actually be reached?', expected: true },
      { prompt: 'Did we test the bands from smallest to largest?', expected: false },
    ],
  },

  // ── Strings ────────────────────────────────────────────────────────────
  {
    id: 'q-string-comparison-password-v2',
    topicId: 'strings-topic',
    title: 'Matching Answers',
    description:
      'Print whether each pair of answers is the same text, one result per line. Some are equal ' +
      'as text but were built in different ways - make sure your comparison says so.',
    difficulty: 'BEGINNER',
    conceptTags: ['string_comparison'],
    invitesErrors: ['STRING_EQUALITY_WITH_OPERATOR'],
    starterCode: `public class MatchingAnswers {
    public static void main(String[] args) {
        compare("hello", new String("hello"));
        compare("hello", "Hello");
        compare("hello", "hello");
        compare("hello", new String("help"));
    }

    static void compare(String expected, String given) {
        // TODO: print true if the two strings are the same text

    }
}`,
    referenceSolution: `public class MatchingAnswers {
    public static void main(String[] args) {
        compare("hello", new String("hello"));
        compare("hello", "Hello");
        compare("hello", "hello");
        compare("hello", new String("help"));
    }

    static void compare(String expected, String given) {
        System.out.println(expected.equals(given));
    }
}`,
    expectedOutput: "true\nfalse\ntrue\nfalse\n",
    reviewQuestions: [
      { prompt: 'Did we compare the strings with .equals rather than ==?', expected: true },
      { prompt: 'Did our first attempt print false even though the text matched?', expected: false },
      { prompt: 'Could one of us explain what == actually compares for objects?', expected: true },
      { prompt: 'Could we say why "hello" and "Hello" are not the same text?', expected: true },
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
  {
    id: 'q-immutable-strings-vowels',
    topicId: 'strings-topic',
    title: 'Count the Vowels',
    description:
      'Count the vowels in each phrase, capital letters included. Lower-casing the phrase first ' +
      'makes it simpler - as long as you keep the string that toLowerCase gives back.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['immutable_strings', 'loop_boundaries'],
    invitesErrors: ['IGNORED_STRING_METHOD_RESULT', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class VowelCount {
    public static void main(String[] args) {
        report("Pair Programming In Java");
        report("AEIOU and sometimes Y");
    }

    static void report(String phrase) {
        int count = 0;

        // TODO: count a, e, i, o and u in the phrase, upper or lower case

        System.out.println(phrase + ": " + count + " vowels");
    }
}`,
    referenceSolution: `public class VowelCount {
    public static void main(String[] args) {
        report("Pair Programming In Java");
        report("AEIOU and sometimes Y");
    }

    static void report(String phrase) {
        int count = 0;
        String lower = phrase.toLowerCase();

        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u') {
                count++;
            }
        }

        System.out.println(phrase + ": " + count + " vowels");
    }
}`,
    expectedOutput: "Pair Programming In Java: 8 vowels\nAEIOU and sometimes Y: 10 vowels\n",
    reviewQuestions: [
      { prompt: 'Did we store the result of toLowerCase in a variable?', expected: true },
      { prompt: 'Did our count miss the capital vowels in the second phrase?', expected: false },
      { prompt: 'Does the loop stop before lower.length()?', expected: true },
      { prompt: 'Did the navigator count the vowels by hand so we could check the output?', expected: true },
      { prompt: 'Did we call charAt with an index equal to the length?', expected: false },
    ],
  },
  {
    id: 'q-string-comparison-palindromes',
    topicId: 'strings-topic',
    title: 'Palindromes',
    description:
      'Print whether each word reads the same backwards, ignoring capitals. Compare characters ' +
      'from both ends towards the middle - and stop at the middle.',
    difficulty: 'ADVANCED',
    conceptTags: ['string_comparison', 'immutable_strings', 'loop_boundaries'],
    invitesErrors: ['STRING_EQUALITY_WITH_OPERATOR', 'IGNORED_STRING_METHOD_RESULT'],
    starterCode: `public class Palindromes {
    public static void main(String[] args) {
        String[] words = {"Level", "Racecar", "Java", "Noon", "Pair"};

        for (int w = 0; w < words.length; w++) {
            boolean palindrome = false;

            // TODO: compare the word's characters from both ends, ignoring capitals

            System.out.println(words[w] + (palindrome ? ": palindrome" : ": not a palindrome"));
        }
    }
}`,
    referenceSolution: `public class Palindromes {
    public static void main(String[] args) {
        String[] words = {"Level", "Racecar", "Java", "Noon", "Pair"};

        for (int w = 0; w < words.length; w++) {
            boolean palindrome = true;
            String word = words[w].toLowerCase();

            for (int i = 0; i < word.length() / 2; i++) {
                if (word.charAt(i) != word.charAt(word.length() - 1 - i)) {
                    palindrome = false;
                    break;
                }
            }

            System.out.println(words[w] + (palindrome ? ": palindrome" : ": not a palindrome"));
        }
    }
}`,
    expectedOutput:
      "Level: palindrome\nRacecar: palindrome\nJava: not a palindrome\nNoon: palindrome\nPair: not a palindrome\n",
    reviewQuestions: [
      { prompt: 'Does the index from the end start at length - 1?', expected: true },
      { prompt: 'Did "Level" come out as not a palindrome because of its capital L?', expected: false },
      { prompt: 'Did we explain to each other why the loop only needs to reach the middle?', expected: true },
      { prompt: 'Did we compare two strings with == anywhere?', expected: false },
      { prompt: 'Is each word lower-cased before its characters are compared?', expected: true },
    ],
  },
  {
    id: 'q-boolean-logic-long-names',
    topicId: 'strings-topic',
    title: 'Long Names',
    description:
      'Print and count the names longer than four letters. Some entries are missing (null), and ' +
      'asking a missing name for its length crashes - so the null check has to cut the test short.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['boolean_logic'],
    invitesErrors: ['NON_SHORT_CIRCUIT_OPERATOR'],
    starterCode: `public class LongNames {
    public static void main(String[] args) {
        String[] names = {"Ada", null, "Grace", "Katherine", null, "Alan"};
        int count = 0;

        // TODO: print each name longer than 4 letters and count them.
        // Some entries are null.

        System.out.println("Long names: " + count);
    }
}`,
    referenceSolution: `public class LongNames {
    public static void main(String[] args) {
        String[] names = {"Ada", null, "Grace", "Katherine", null, "Alan"};
        int count = 0;

        for (int i = 0; i < names.length; i++) {
            if (names[i] != null && names[i].length() > 4) {
                System.out.println(names[i]);
                count++;
            }
        }

        System.out.println("Long names: " + count);
    }
}`,
    expectedOutput: "Grace\nKatherine\nLong names: 2\n",
    reviewQuestions: [
      { prompt: 'Is the null check written before the length check?', expected: true },
      { prompt: 'Did we use a single & between the two checks?', expected: false },
      { prompt: 'Did we get a NullPointerException on one of our runs?', expected: false },
      { prompt: 'Did we explain to each other why && skips the second check?', expected: true },
    ],
  },
  {
    id: 'q-loop-control-run-length',
    topicId: 'strings-topic',
    title: 'Run-Length Code',
    description:
      'Shorten each word by writing every letter once, followed by how many times it repeats in a ' +
      'row: aaab becomes a3b1. Let the for loop move the index - changing i inside the body as ' +
      'well makes the loop skip letters.',
    difficulty: 'ADVANCED',
    conceptTags: ['loop_control'],
    invitesErrors: ['LOOP_COUNTER_CHANGED_IN_BODY', 'INDEX_PLUS_ONE_OUT_OF_BOUNDS'],
    starterCode: `public class RunLength {
    static String encode(String text) {
        String result = "";

        // TODO: for each run of the same letter, add the letter and the run's length

        return result;
    }

    public static void main(String[] args) {
        String[] words = {"aaabccdd", "abc", "zzzz"};
        for (int i = 0; i < words.length; i++) {
            System.out.println(words[i] + " -> " + encode(words[i]));
        }
    }
}`,
    referenceSolution: `public class RunLength {
    static String encode(String text) {
        String result = "";
        int count = 0;

        for (int i = 0; i < text.length(); i++) {
            count++;
            if (i == text.length() - 1 || text.charAt(i) != text.charAt(i + 1)) {
                result = result + text.charAt(i) + count;
                count = 0;
            }
        }

        return result;
    }

    public static void main(String[] args) {
        String[] words = {"aaabccdd", "abc", "zzzz"};
        for (int i = 0; i < words.length; i++) {
            System.out.println(words[i] + " -> " + encode(words[i]));
        }
    }
}`,
    expectedOutput: "aaabccdd -> a3b1c2d2\nabc -> a1b1c1\nzzzz -> z4\n",
    reviewQuestions: [
      { prompt: 'Is i changed only in the for loop header?', expected: true },
      { prompt: 'Did our first version skip letters or repeat them?', expected: false },
      { prompt: 'Is the run count started again after each run is written?', expected: true },
      { prompt: 'Did we trace "aaab" on paper together before coding the loop?', expected: true },
      { prompt: 'Did reading the next letter crash on the last character?', expected: false },
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
  {
    id: 'q-arithmetic-operations-temperatures',
    topicId: 'expressions-topic',
    title: 'Temperature Table',
    description:
      'Convert each Celsius temperature to Fahrenheit with F = C × 9 / 5 + 32. The formula is ' +
      'already there and most rows look right - but 37 °C should be 98.6 °F. Find out why it is not.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['arithmetic_operations'],
    invitesErrors: ['INTEGER_DIVISION_IN_DECIMAL_CONTEXT'],
    starterCode: `public class Temperatures {
    public static void main(String[] args) {
        int[] celsius = {-40, 0, 20, 37, 100};

        for (int i = 0; i < celsius.length; i++) {
            // TODO: 37 C comes out as 98.0 F. Why, and what is the smallest fix?
            double fahrenheit = celsius[i] * 9 / 5 + 32;
            System.out.println(celsius[i] + " C = " + fahrenheit + " F");
        }
    }
}`,
    referenceSolution: `public class Temperatures {
    public static void main(String[] args) {
        int[] celsius = {-40, 0, 20, 37, 100};

        for (int i = 0; i < celsius.length; i++) {
            double fahrenheit = celsius[i] * 9.0 / 5 + 32;
            System.out.println(celsius[i] + " C = " + fahrenheit + " F");
        }
    }
}`,
    expectedOutput: "-40 C = -40.0 F\n0 C = 32.0 F\n20 C = 68.0 F\n37 C = 98.6 F\n100 C = 212.0 F\n",
    reviewQuestions: [
      { prompt: 'Did we work out why only 37 came out wrong while the other rows were right?', expected: true },
      { prompt: 'Did we think storing the result in a double was enough to keep the decimals?', expected: false },
      { prompt: 'Does at least one number in the division have a decimal point now?', expected: true },
      { prompt: 'Did the navigator calculate 37 × 9 / 5 by hand, as Java would?', expected: true },
      { prompt: 'Did we change the values in the array to make the output match?', expected: false },
    ],
  },
  {
    id: 'q-assignment-logic-counter',
    topicId: 'expressions-topic',
    title: 'Fix the Counter',
    description:
      'The program should count how many marks are a pass (50 or more) and how many are not, but ' +
      'both counts stay at 0. The increments run - so why do they change nothing?',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['assignment_logic'],
    invitesErrors: ['POSTFIX_INCREMENT_ASSIGNED_BACK', 'SELF_ASSIGNMENT'],
    starterCode: `public class CountPasses {
    public static void main(String[] args) {
        int[] marks = {72, 45, 50, 38, 91, 66};
        int passed = 0;
        int failed = 0;

        for (int i = 0; i < marks.length; i++) {
            if (marks[i] >= 50) {
                passed = passed++; // TODO: this runs four times - why does passed stay 0?
            } else {
                failed = failed++;
            }
        }

        System.out.println("Passed: " + passed);
        System.out.println("Failed: " + failed);
    }
}`,
    referenceSolution: `public class CountPasses {
    public static void main(String[] args) {
        int[] marks = {72, 45, 50, 38, 91, 66};
        int passed = 0;
        int failed = 0;

        for (int i = 0; i < marks.length; i++) {
            if (marks[i] >= 50) {
                passed++;
            } else {
                failed++;
            }
        }

        System.out.println("Passed: " + passed);
        System.out.println("Failed: " + failed);
    }
}`,
    expectedOutput: "Passed: 4\nFailed: 2\n",
    reviewQuestions: [
      { prompt: 'Can we explain what value passed++ hands back before it adds one?', expected: true },
      { prompt: 'Did we fix it by starting the counters at a different number?', expected: false },
      { prompt: 'Is each counter now updated by a single passed++ or failed++ on its own?', expected: true },
      { prompt: 'Did we check the counts against the marks together, one by one?', expected: true },
      { prompt: 'Is a mark of exactly 50 counted as a fail?', expected: false },
    ],
  },
  {
    id: 'q-arithmetic-operations-receipt',
    topicId: 'expressions-topic',
    title: 'Check the Receipt',
    description:
      'Add up three prices and check the total against the receipt. 0.10 + 0.20 + 0.30 is 0.60 on ' +
      'paper, but not quite in a double - print the total in cents, what == says, and what a safe ' +
      'comparison says.',
    difficulty: 'ADVANCED',
    conceptTags: ['arithmetic_operations', 'boolean_logic'],
    invitesErrors: ['DECIMAL_EQUALITY_COMPARISON'],
    starterCode: `public class ReceiptCheck {
    public static void main(String[] args) {
        double[] prices = {0.10, 0.20, 0.30};
        double receipt = 0.60;
        double total = 0;

        // TODO: add up the prices

        System.out.println("Total: " + Math.round(total * 100) + " cents");
        System.out.println("Equal with ==: " + false); // TODO: compare total and receipt with ==
        System.out.println("Equal within a tolerance: " + false); // TODO: compare them safely
    }
}`,
    referenceSolution: `public class ReceiptCheck {
    public static void main(String[] args) {
        double[] prices = {0.10, 0.20, 0.30};
        double receipt = 0.60;
        double total = 0;

        for (int i = 0; i < prices.length; i++) {
            total += prices[i];
        }

        System.out.println("Total: " + Math.round(total * 100) + " cents");
        System.out.println("Equal with ==: " + (total == receipt));
        System.out.println("Equal within a tolerance: " + (Math.abs(total - receipt) < 0.000001));
    }
}`,
    expectedOutput: "Total: 60 cents\nEqual with ==: false\nEqual within a tolerance: true\n",
    reviewQuestions: [
      { prompt: 'Can we say why == gives false for two numbers that both print as 0.6?', expected: true },
      { prompt: 'Did we expect == to print true before we ran it?', expected: false },
      { prompt: 'Does the safe comparison check that the difference is very small?', expected: true },
      { prompt: 'Did we discuss together where else money should not be stored in a double?', expected: true },
      { prompt: 'Did we round the total before comparing to make == come out true?', expected: false },
    ],
  },
  {
    id: 'q-statement-structure-discount-note',
    topicId: 'expressions-topic',
    title: 'Discount Note',
    description:
      'Orders over 100 get 15 off and a note saying so; every order then prints what is to pay. ' +
      'Two statements belong to the if - and indenting a line does not put it inside one.',
    difficulty: 'BEGINNER',
    conceptTags: ['statement_structure'],
    invitesErrors: ['MISLEADING_INDENTATION_NO_BRACES', 'EMPTY_CONDITIONAL_BODY'],
    starterCode: `public class DiscountNote {
    public static void main(String[] args) {
        int[] totals = {80, 150, 120};

        for (int i = 0; i < totals.length; i++) {
            int toPay = totals[i];

            // TODO: over 100, take 15 off and print "Order N: discount applied".
            // Then, for every order, print "Order N: pay " and the amount.

        }
    }
}`,
    referenceSolution: `public class DiscountNote {
    public static void main(String[] args) {
        int[] totals = {80, 150, 120};

        for (int i = 0; i < totals.length; i++) {
            int toPay = totals[i];

            if (totals[i] > 100) {
                toPay = totals[i] - 15;
                System.out.println("Order " + (i + 1) + ": discount applied");
            }
            System.out.println("Order " + (i + 1) + ": pay " + toPay);
        }
    }
}`,
    expectedOutput:
      "Order 1: pay 80\nOrder 2: discount applied\nOrder 2: pay 135\nOrder 3: discount applied\nOrder 3: pay 105\n",
    reviewQuestions: [
      { prompt: 'Did we put braces around both statements that belong to the if?', expected: true },
      { prompt: 'Did order 1 print "discount applied"?', expected: false },
      { prompt: 'Did the driver read out which lines run for an order of 80 before we ran it?', expected: true },
      { prompt: 'Did we rely on indentation alone to show what the if controls?', expected: false },
    ],
  },

  // ── Methods and Return Values ──────────────────────────────────────────
  {
    id: 'q-control-flow-largest-of-three',
    topicId: 'methods-topic',
    title: 'Largest of Three',
    description:
      'Finish the method that returns the largest of three numbers. It is called with negative ' +
      'numbers too, so think about what your "largest so far" should start as.',
    difficulty: 'BEGINNER',
    conceptTags: ['control_flow', 'conditional_logic'],
    invitesErrors: ['INCORRECT_CONDITIONAL_OPERATOR', 'UNREACHABLE_CODE_AFTER_RETURN'],
    starterCode: `public class LargestOfThree {
    public static void main(String[] args) {
        show(3, 9, 4);
        show(8, 2, 8);
        show(-1, -5, -3);
    }

    static int largest(int a, int b, int c) {
        // TODO: return the largest of a, b and c
        return 0;
    }

    static void show(int a, int b, int c) {
        System.out.println("largest(" + a + ", " + b + ", " + c + ") = " + largest(a, b, c));
    }
}`,
    referenceSolution: `public class LargestOfThree {
    public static void main(String[] args) {
        show(3, 9, 4);
        show(8, 2, 8);
        show(-1, -5, -3);
    }

    static int largest(int a, int b, int c) {
        int max = a;
        if (b > max) {
            max = b;
        }
        if (c > max) {
            max = c;
        }
        return max;
    }

    static void show(int a, int b, int c) {
        System.out.println("largest(" + a + ", " + b + ", " + c + ") = " + largest(a, b, c));
    }
}`,
    expectedOutput: "largest(3, 9, 4) = 9\nlargest(8, 2, 8) = 8\nlargest(-1, -5, -3) = -1\n",
    reviewQuestions: [
      { prompt: 'Does the method give the right answer when all three numbers are negative?', expected: true },
      { prompt: 'Did we start the largest-so-far at 0?', expected: false },
      { prompt: 'Did we agree on what the method should return before writing it?', expected: true },
      { prompt: 'Does the method print anything itself?', expected: false },
      { prompt: 'Did we test the case where two numbers are equal?', expected: true },
    ],
  },
  {
    id: 'q-loop-initialization-factorial',
    topicId: 'methods-topic',
    title: 'Factorial',
    description:
      'Write a method that returns n! - the product 1 × 2 × ... × n, where 0! is 1. Decide together ' +
      'what the product starts at, and use a long: 10! is too big for comfort in an int.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['loop_initialization', 'arithmetic_operations'],
    invitesErrors: ['OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class Factorials {
    public static void main(String[] args) {
        int[] values = {0, 1, 5, 10};
        for (int i = 0; i < values.length; i++) {
            System.out.println(values[i] + "! = " + factorial(values[i]));
        }
    }

    static long factorial(int n) {
        // TODO: multiply 1 x 2 x ... x n
        return 0;
    }
}`,
    referenceSolution: `public class Factorials {
    public static void main(String[] args) {
        int[] values = {0, 1, 5, 10};
        for (int i = 0; i < values.length; i++) {
            System.out.println(values[i] + "! = " + factorial(values[i]));
        }
    }

    static long factorial(int n) {
        long result = 1;
        for (int k = 2; k <= n; k++) {
            result = result * k;
        }
        return result;
    }
}`,
    expectedOutput: "0! = 1\n1! = 1\n5! = 120\n10! = 3628800\n",
    reviewQuestions: [
      { prompt: 'Does the product start at 1 rather than 0?', expected: true },
      { prompt: 'Did every factorial come out as 0 in one of our runs?', expected: false },
      { prompt: 'Does the loop include n itself?', expected: true },
      { prompt: 'Did the navigator check 5! = 120 by hand before we ran it?', expected: true },
      { prompt: 'Did we need a special if for 0?', expected: false },
    ],
  },
  {
    id: 'q-loop-termination-gcd',
    topicId: 'methods-topic',
    title: 'Simplify a Fraction',
    description:
      'Write gcd(a, b) with Euclid\'s method: while b is not 0, replace a with b and b with a % b; ' +
      'then a is the answer. Use it to simplify 48/18. The order of the assignments is the whole trick.',
    difficulty: 'ADVANCED',
    conceptTags: ['loop_termination', 'arithmetic_operations', 'assignment_logic'],
    invitesErrors: ['WHILE_VARIABLE_NOT_UPDATED', 'SELF_ASSIGNMENT'],
    starterCode: `public class Fractions {
    public static void main(String[] args) {
        System.out.println("gcd(48, 18) = " + gcd(48, 18));
        System.out.println("gcd(17, 5) = " + gcd(17, 5));
        System.out.println("gcd(100, 75) = " + gcd(100, 75));

        int top = 48;
        int bottom = 18;
        // TODO: divide top and bottom by their gcd
        System.out.println(top + "/" + bottom + " simplifies to " + top + "/" + bottom);
    }

    static int gcd(int a, int b) {
        // TODO: Euclid's method
        return 1;
    }
}`,
    referenceSolution: `public class Fractions {
    public static void main(String[] args) {
        System.out.println("gcd(48, 18) = " + gcd(48, 18));
        System.out.println("gcd(17, 5) = " + gcd(17, 5));
        System.out.println("gcd(100, 75) = " + gcd(100, 75));

        int top = 48;
        int bottom = 18;
        int d = gcd(top, bottom);
        System.out.println(top + "/" + bottom + " simplifies to " + (top / d) + "/" + (bottom / d));
    }

    static int gcd(int a, int b) {
        while (b != 0) {
            int remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }
}`,
    expectedOutput: "gcd(48, 18) = 6\ngcd(17, 5) = 1\ngcd(100, 75) = 25\n48/18 simplifies to 8/3\n",
    reviewQuestions: [
      { prompt: 'Did we keep a % b in a temporary variable before changing a?', expected: true },
      { prompt: 'Did our loop ever run forever because b stayed the same?', expected: false },
      { prompt: 'Did we trace gcd(48, 18) on paper together, one pass at a time?', expected: true },
      { prompt: 'Is the gcd worked out by the method rather than written into main?', expected: true },
      { prompt: 'Did we write a = a anywhere?', expected: false },
    ],
  },
  {
    id: 'q-control-flow-all-even',
    topicId: 'methods-topic',
    title: 'All Even?',
    description:
      'Write allEven, which answers whether every number in the array is even. One odd number ' +
      'settles it as false straight away - but true has to wait until every number has been checked.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['control_flow', 'boolean_logic'],
    invitesErrors: ['EARLY_RETURN_IN_LOOP', 'UNREACHABLE_CODE_AFTER_RETURN'],
    starterCode: `public class AllEven {
    static boolean allEven(int[] values) {
        // TODO: false as soon as an odd number turns up; true only after checking them all
        return false;
    }

    public static void main(String[] args) {
        System.out.println("2 4 6 -> " + allEven(new int[] {2, 4, 6}));
        System.out.println("2 4 7 -> " + allEven(new int[] {2, 4, 7}));
        System.out.println("3 4 6 -> " + allEven(new int[] {3, 4, 6}));
        System.out.println("empty -> " + allEven(new int[] {}));
    }
}`,
    referenceSolution: `public class AllEven {
    static boolean allEven(int[] values) {
        for (int i = 0; i < values.length; i++) {
            if (values[i] % 2 != 0) {
                return false;
            }
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println("2 4 6 -> " + allEven(new int[] {2, 4, 6}));
        System.out.println("2 4 7 -> " + allEven(new int[] {2, 4, 7}));
        System.out.println("3 4 6 -> " + allEven(new int[] {3, 4, 6}));
        System.out.println("empty -> " + allEven(new int[] {}));
    }
}`,
    expectedOutput: "2 4 6 -> true\n2 4 7 -> false\n3 4 6 -> false\nempty -> true\n",
    reviewQuestions: [
      { prompt: 'Does the method return true only after the loop has finished?', expected: true },
      { prompt: 'Did our method decide after looking at the first number only?', expected: false },
      { prompt: 'Did we agree together what an empty array should give?', expected: true },
      { prompt: 'Is there an else branch inside the loop that returns true?', expected: false },
    ],
  },

  // ── Nested Loops and 2D Arrays ─────────────────────────────────────────
  {
    id: 'q-loop-boundaries-staircase',
    topicId: 'nested-topic',
    title: 'Star Staircase',
    description:
      'Print a staircase of stars five rows high: one star on the first row, two on the second, ' +
      'and so on. The inner loop\'s limit depends on which row the outer loop is on.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_boundaries', 'loop_initialization'],
    invitesErrors: ['OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class Staircase {
    public static void main(String[] args) {
        int height = 5;

        for (int row = 1; row <= height; row++) {
            String line = "";
            // TODO: add the right number of stars to line for this row
            System.out.println(line);
        }
    }
}`,
    referenceSolution: `public class Staircase {
    public static void main(String[] args) {
        int height = 5;

        for (int row = 1; row <= height; row++) {
            String line = "";
            for (int col = 1; col <= row; col++) {
                line = line + "*";
            }
            System.out.println(line);
        }
    }
}`,
    expectedOutput: "*\n**\n***\n****\n*****\n",
    reviewQuestions: [
      { prompt: 'Does the inner loop use the row number as its limit?', expected: true },
      { prompt: 'Did our first staircase have an empty first row or six rows?', expected: false },
      { prompt: 'Did we talk about which loop draws rows and which draws stars?', expected: true },
      { prompt: 'Is line emptied again at the start of each row?', expected: true },
    ],
  },
  {
    id: 'q-loop-boundaries-times-table',
    topicId: 'nested-topic',
    title: 'Times Table',
    description:
      'Print the 5 × 5 times table: five rows of five products, each product four characters ' +
      'wide using the cell method provided. Both loops run from 1 to 5 - check both ends of each.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['loop_boundaries', 'loop_control'],
    invitesErrors: ['OFF_BY_ONE_LOOP_BOUNDARY', 'LOOP_UPDATE_WRONG_DIRECTION'],
    starterCode: `public class TimesTable {
    public static void main(String[] args) {
        // TODO: five rows; each row is cell(row * col) for col 1 to 5, printed as one line

    }

    static String cell(int value) {
        return String.format("%4d", value);
    }
}`,
    referenceSolution: `public class TimesTable {
    public static void main(String[] args) {
        for (int row = 1; row <= 5; row++) {
            String line = "";
            for (int col = 1; col <= 5; col++) {
                line = line + cell(row * col);
            }
            System.out.println(line);
        }
    }

    static String cell(int value) {
        return String.format("%4d", value);
    }
}`,
    expectedOutput:
      "   1   2   3   4   5\n   2   4   6   8  10\n   3   6   9  12  15\n   4   8  12  16  20\n   5  10  15  20  25\n",
    reviewQuestions: [
      { prompt: 'Does each row come out on one line rather than one number per line?', expected: true },
      { prompt: 'Did our table start with a row or a column of zeros?', expected: false },
      { prompt: 'Did we decide together which loop is the row and which the column?', expected: true },
      { prompt: 'Is the bottom-right cell 25?', expected: true },
      { prompt: 'Did we print a product outside the inner loop by mistake?', expected: false },
    ],
  },
  {
    id: 'q-array-indexing-grid-totals',
    topicId: 'nested-topic',
    title: 'Row and Column Totals',
    description:
      'Print the total of each row, then of each column, of a 3 × 4 grid of sales. The grid has ' +
      'three rows but four columns - sales.length and sales[0].length are different numbers.',
    difficulty: 'ADVANCED',
    conceptTags: ['array_indexing', 'loop_boundaries'],
    invitesErrors: ['ARRAY_LENGTH_INDEX_MISUSE', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class GridTotals {
    public static void main(String[] args) {
        int[][] sales = {
            {4, 7, 1, 9},
            {3, 0, 6, 2},
            {8, 5, 5, 1}
        };

        // TODO: print "Row 1: <total>" for each row, then "Column 1: <total>" for each column

    }
}`,
    referenceSolution: `public class GridTotals {
    public static void main(String[] args) {
        int[][] sales = {
            {4, 7, 1, 9},
            {3, 0, 6, 2},
            {8, 5, 5, 1}
        };

        for (int r = 0; r < sales.length; r++) {
            int total = 0;
            for (int c = 0; c < sales[r].length; c++) {
                total += sales[r][c];
            }
            System.out.println("Row " + (r + 1) + ": " + total);
        }

        for (int c = 0; c < sales[0].length; c++) {
            int total = 0;
            for (int r = 0; r < sales.length; r++) {
                total += sales[r][c];
            }
            System.out.println("Column " + (c + 1) + ": " + total);
        }
    }
}`,
    expectedOutput:
      "Row 1: 21\nRow 2: 11\nRow 3: 19\nColumn 1: 15\nColumn 2: 12\nColumn 3: 12\nColumn 4: 12\n",
    reviewQuestions: [
      { prompt: 'Do the column loops use sales[0].length for the number of columns?', expected: true },
      { prompt: 'Did we get an ArrayIndexOutOfBoundsException from mixing up rows and columns?', expected: false },
      { prompt: 'Is each total reset to 0 before its row or column is added up?', expected: true },
      { prompt: 'Did the navigator check that the row totals and column totals add up to the same grand total?', expected: true },
      { prompt: 'Did we write 3 or 4 as a loop limit instead of using a length?', expected: false },
    ],
  },
  {
    id: 'q-array-indexing-pair-sums',
    topicId: 'nested-topic',
    title: 'Pairs That Add Up',
    description:
      'Print every pair of values at two different positions that adds up to the target. The outer ' +
      'loop picks the first value and the inner loop the second - so each one indexes with its own counter.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['array_indexing', 'loop_control'],
    invitesErrors: ['WRONG_LOOP_VARIABLE_IN_INDEX', 'NESTED_LOOP_WRONG_COUNTER'],
    starterCode: `public class PairSums {
    public static void main(String[] args) {
        int[] values = {3, 8, 5, 2, 6};
        int target = 8;

        // TODO: print "a + b" for every pair of different positions adding up to target

    }
}`,
    referenceSolution: `public class PairSums {
    public static void main(String[] args) {
        int[] values = {3, 8, 5, 2, 6};
        int target = 8;

        for (int i = 0; i < values.length; i++) {
            for (int j = i + 1; j < values.length; j++) {
                if (values[i] + values[j] == target) {
                    System.out.println(values[i] + " + " + values[j]);
                }
            }
        }
    }
}`,
    expectedOutput: "3 + 5\n2 + 6\n",
    reviewQuestions: [
      { prompt: 'Does the inner loop index the array with j rather than i?', expected: true },
      { prompt: 'Did we print any pair twice, once in each order?', expected: false },
      { prompt: 'Did we list the pairs by hand together first?', expected: true },
      { prompt: 'Did a value get paired with itself?', expected: false },
    ],
  },
  {
    id: 'q-loop-control-seat-labels',
    topicId: 'nested-topic',
    title: 'Seat Labels',
    description:
      'Print the seat labels for rows A to C with four seats each, one row per line. The inner ' +
      'loop has its own counter - its condition and its update must both use it.',
    difficulty: 'BEGINNER',
    conceptTags: ['loop_control'],
    invitesErrors: ['NESTED_LOOP_WRONG_COUNTER', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class SeatLabels {
    public static void main(String[] args) {
        String rows = "ABC";
        int seatsPerRow = 4;

        // TODO: one line per row; the first line is A1 A2 A3 A4

    }
}`,
    referenceSolution: `public class SeatLabels {
    public static void main(String[] args) {
        String rows = "ABC";
        int seatsPerRow = 4;

        for (int r = 0; r < rows.length(); r++) {
            String line = "";
            for (int s = 1; s <= seatsPerRow; s++) {
                line = line + rows.charAt(r) + s;
                if (s < seatsPerRow) {
                    line = line + " ";
                }
            }
            System.out.println(line);
        }
    }
}`,
    expectedOutput: "A1 A2 A3 A4\nB1 B2 B3 B4\nC1 C2 C3 C4\n",
    reviewQuestions: [
      { prompt: 'Does the inner loop test and step its own counter?', expected: true },
      { prompt: 'Did the program hang because a loop never reached its end?', expected: false },
      { prompt: 'Did we decide together which loop handles rows and which handles seats?', expected: true },
      { prompt: 'Did a line end with a trailing space?', expected: false },
    ],
  },

  // ── Searching and Sorting ──────────────────────────────────────────────
  {
    id: 'q-loop-control-first-frost',
    topicId: 'algorithms-topic',
    title: 'First Frost',
    description:
      'Find the first day of each week with a temperature below zero, and stop searching as soon ' +
      'as you find it. A week may have no frost at all, so the search must not run off the end.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['loop_control', 'boolean_logic'],
    invitesErrors: ['ARRAY_LENGTH_INDEX_MISUSE', 'ALWAYS_FALSE_AND_CONDITION'],
    starterCode: `public class FirstFrost {
    public static void main(String[] args) {
        report(1, new int[] {3, 1, -2, 4, -5, 0});
        report(2, new int[] {5, 6, 7, 4, 2, 8, 6});
    }

    static void report(int week, int[] temps) {
        // TODO: find the first day below zero and print
        //   "Week <n>: first frost on day <day number> (<temperature>)"
        // or, when there is none, "Week <n>: no frost". Days are numbered from 1.
    }
}`,
    referenceSolution: `public class FirstFrost {
    public static void main(String[] args) {
        report(1, new int[] {3, 1, -2, 4, -5, 0});
        report(2, new int[] {5, 6, 7, 4, 2, 8, 6});
    }

    static void report(int week, int[] temps) {
        int day = 0;
        while (day < temps.length && temps[day] >= 0) {
            day++;
        }

        if (day < temps.length) {
            System.out.println("Week " + week + ": first frost on day " + (day + 1) + " (" + temps[day] + ")");
        } else {
            System.out.println("Week " + week + ": no frost");
        }
    }
}`,
    expectedOutput: "Week 1: first frost on day 3 (-2)\nWeek 2: no frost\n",
    reviewQuestions: [
      { prompt: 'Does the search check it is still inside the array before reading temps[day]?', expected: true },
      { prompt: 'Did we report day 5, the last frost, instead of the first?', expected: false },
      { prompt: 'Did we discuss what should happen in a week with no frost before coding it?', expected: true },
      { prompt: 'Is the day printed counting from 1, not from 0?', expected: true },
      { prompt: 'Did we keep looping after the first frost was found?', expected: false },
    ],
  },
  {
    id: 'q-assignment-logic-bubble-sort',
    topicId: 'algorithms-topic',
    title: 'Bubble Sort',
    description:
      'Sort the array into ascending order by repeatedly swapping neighbours that are the wrong ' +
      'way round. A swap needs a third variable, and each pass can stop one place earlier than the last.',
    difficulty: 'ADVANCED',
    conceptTags: ['assignment_logic', 'loop_boundaries'],
    invitesErrors: ['SELF_ASSIGNMENT', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class BubbleSort {
    public static void main(String[] args) {
        int[] values = {29, 3, 17, 8, 42, 11};
        show("Before", values);

        // TODO: compare each pair of neighbours and swap them when they are out of order,
        // pass after pass, until the array is sorted

        show("After", values);
    }

    static void show(String label, int[] values) {
        String line = label + ":";
        for (int i = 0; i < values.length; i++) {
            line = line + " " + values[i];
        }
        System.out.println(line);
    }
}`,
    referenceSolution: `public class BubbleSort {
    public static void main(String[] args) {
        int[] values = {29, 3, 17, 8, 42, 11};
        show("Before", values);

        for (int pass = 0; pass < values.length - 1; pass++) {
            for (int i = 0; i < values.length - 1 - pass; i++) {
                if (values[i] > values[i + 1]) {
                    int temp = values[i];
                    values[i] = values[i + 1];
                    values[i + 1] = temp;
                }
            }
        }

        show("After", values);
    }

    static void show(String label, int[] values) {
        String line = label + ":";
        for (int i = 0; i < values.length; i++) {
            line = line + " " + values[i];
        }
        System.out.println(line);
    }
}`,
    expectedOutput: "Before: 29 3 17 8 42 11\nAfter: 3 8 11 17 29 42\n",
    reviewQuestions: [
      { prompt: 'Does the swap use a temporary variable so no value is lost?', expected: true },
      { prompt: 'Did one of our swaps copy the same value into both places?', expected: false },
      { prompt: 'Does the inner loop stop before reading values[i + 1] past the end?', expected: true },
      { prompt: 'Did we act out a pass together with the numbers written down?', expected: true },
      { prompt: 'Did we use a library method to sort the array?', expected: false },
    ],
  },
  {
    id: 'q-loop-termination-binary-search',
    topicId: 'algorithms-topic',
    title: 'Binary Search',
    description:
      'Find each target in the sorted array by halving the range you search: look at the middle, ' +
      'then keep only the half the target can be in. The loop ends when the range is empty - and ' +
      'only if low or high moves every time.',
    difficulty: 'ADVANCED',
    conceptTags: ['loop_termination', 'conditional_logic'],
    invitesErrors: ['WHILE_VARIABLE_NOT_UPDATED', 'OFF_BY_ONE_LOOP_BOUNDARY'],
    starterCode: `public class BinarySearch {
    public static void main(String[] args) {
        int[] sorted = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        int[] targets = {23, 2, 91, 40};

        for (int t = 0; t < targets.length; t++) {
            int index = search(sorted, targets[t]);
            if (index >= 0) {
                System.out.println(targets[t] + " found at index " + index);
            } else {
                System.out.println(targets[t] + " not found");
            }
        }
    }

    static int search(int[] values, int target) {
        // TODO: binary search - return the index of target, or -1 if it is not there
        return -1;
    }
}`,
    referenceSolution: `public class BinarySearch {
    public static void main(String[] args) {
        int[] sorted = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        int[] targets = {23, 2, 91, 40};

        for (int t = 0; t < targets.length; t++) {
            int index = search(sorted, targets[t]);
            if (index >= 0) {
                System.out.println(targets[t] + " found at index " + index);
            } else {
                System.out.println(targets[t] + " not found");
            }
        }
    }

    static int search(int[] values, int target) {
        int low = 0;
        int high = values.length - 1;

        while (low <= high) {
            int mid = (low + high) / 2;
            if (values[mid] == target) {
                return mid;
            } else if (values[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return -1;
    }
}`,
    expectedOutput: "23 found at index 5\n2 found at index 0\n91 found at index 9\n40 not found\n",
    reviewQuestions: [
      { prompt: 'Does low or high move past mid on every pass that does not find the target?', expected: true },
      { prompt: 'Did our search miss the first or the last element of the array?', expected: false },
      { prompt: 'Is the loop condition low <= high rather than low < high?', expected: true },
      { prompt: 'Did we predict together how many passes it takes to find 23?', expected: true },
      { prompt: 'Did we check every element from the start instead of halving the range?', expected: false },
    ],
  },
  {
    id: 'q-loop-initialization-extremes',
    topicId: 'algorithms-topic',
    title: 'Coldest and Warmest',
    description:
      'Report the coldest and the warmest reading for winter and for summer. Winter is all below ' +
      'zero and summer all above it, so whatever the search starts from has to be a real reading.',
    difficulty: 'INTERMEDIATE',
    conceptTags: ['loop_initialization'],
    invitesErrors: ['WRONG_EXTREME_INITIAL_VALUE'],
    starterCode: `public class Extremes {
    static void report(String label, int[] readings) {
        // TODO: find the coldest and the warmest reading, then print
        // label + ": coldest " + ... + ", warmest " + ...
    }

    public static void main(String[] args) {
        report("Winter", new int[] {-4, -11, -2, -7});
        report("Summer", new int[] {24, 31, 27, 29});
    }
}`,
    referenceSolution: `public class Extremes {
    static void report(String label, int[] readings) {
        int coldest = readings[0];
        int warmest = readings[0];

        for (int i = 1; i < readings.length; i++) {
            if (readings[i] < coldest) {
                coldest = readings[i];
            }
            if (readings[i] > warmest) {
                warmest = readings[i];
            }
        }

        System.out.println(label + ": coldest " + coldest + ", warmest " + warmest);
    }

    public static void main(String[] args) {
        report("Winter", new int[] {-4, -11, -2, -7});
        report("Summer", new int[] {24, 31, 27, 29});
    }
}`,
    expectedOutput: "Winter: coldest -11, warmest -2\nSummer: coldest 24, warmest 31\n",
    reviewQuestions: [
      { prompt: 'Do coldest and warmest start from a reading in the array?', expected: true },
      { prompt: 'Did our program report 0 as the warmest winter reading?', expected: false },
      { prompt: 'Did we explain to each other why starting from 0 fails for winter?', expected: true },
      { prompt: 'Did the summer line say coldest 0?', expected: false },
    ],
  },
];

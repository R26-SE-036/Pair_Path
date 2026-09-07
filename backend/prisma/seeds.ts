import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function seedDatabase() {
  // Create sample topics
  const arraysTopic = await prisma.topic.create({
    data: {
      id: 'arrays-topic',
      name: 'Arrays and Indexing',
      description: 'Working with Java arrays, indexing, and bounds checking',
    },
  });

  const loopsTopic = await prisma.topic.create({
    data: {
      id: 'loops-topic',
      name: 'Loops and Iteration',
      description: 'For loops, while loops, and iteration patterns',
    },
  });

  const conditionsTopic = await prisma.topic.create({
    data: {
      id: 'conditions-topic',
      name: 'Conditions and Logic',
      description: 'If-else statements and conditional logic',
    },
  });

  // Create sample questions
  const question1 = await prisma.question.create({
    data: {
      id: 'array-bounds-question',
      title: 'Array Bounds Checking',
      description: 'Write a Java program that demonstrates proper array bounds checking.',
      difficulty: 'BEGINNER',
      topicId: arraysTopic.id,
      starterCode: `public class ArrayBounds {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        // TODO: Print all elements with proper bounds checking
    }
}`,
      referenceSolution: `public class ArrayBounds {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        // Proper bounds checking
        for (int i = 0; i < numbers.length; i++) {
            System.out.println("Element at index " + i + ": " + numbers[i]);
        }
    }
}`,
      conceptTags: ['arrays', 'indexing', 'bounds'],
      reviewQuestions: [
        'Did we check array bounds before accessing elements?',
        'Did we use the correct loop condition?',
        'Did we handle edge cases properly?',
        'Did we test with different array sizes?',
        'Did we understand zero-based indexing?',
        'Did we use proper variable names?',
        'Did we follow Java coding conventions?',
        'Did we add comments where necessary?',
        'Did we test our solution?',
        'Did we consider alternative approaches?'
      ],
    },
  });

  const question2 = await prisma.question.create({
    data: {
      id: 'loop-sum-question',
      title: 'Sum of Array Elements',
      description: 'Write a Java program that calculates the sum of all elements in an array.',
      difficulty: 'BEGINNER',
      topicId: loopsTopic.id,
      starterCode: `public class ArraySum {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        int sum = 0;
        // TODO: Calculate sum of all elements
    }
}`,
      referenceSolution: `public class ArraySum {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        int sum = 0;
        // Calculate sum using for loop
        for (int i = 0; i < numbers.length; i++) {
            sum += numbers[i];
        }
        System.out.println("Sum: " + sum);
    }
}`,
      conceptTags: ['arrays', 'loops', 'iteration'],
      reviewQuestions: [
        'Did we initialize the sum variable correctly?',
        'Did we use the correct loop condition?',
        'Did we accumulate the sum properly?',
        'Did we handle empty arrays?',
        'Did we test with different values?',
        'Did we use meaningful variable names?',
        'Did we follow Java coding conventions?',
        'Did we add comments where necessary?',
        'Did we test our solution?',
        'Did we consider using enhanced for loops?'
      ],
    },
  });

  const question3 = await prisma.question.create({
    data: {
      id: 'conditional-logic-question',
      title: 'Even or Odd Number',
      description: 'Write a Java program that determines if a number is even or odd.',
      difficulty: 'BEGINNER',
      topicId: conditionsTopic.id,
      starterCode: `public class EvenOdd {
    public static void main(String[] args) {
        int number = 7;
        // TODO: Determine if number is even or odd
    }
}`,
      referenceSolution: `public class EvenOdd {
    public static void main(String[] args) {
        int number = 7;
        // Use modulo operator to check even/odd
        if (number % 2 == 0) {
            System.out.println(number + " is even");
        } else {
            System.out.println(number + " is odd");
        }
    }
}`,
      conceptTags: ['conditions', 'modulo', 'logic'],
      reviewQuestions: [
        'Did we use the correct conditional operator?',
        'Did we handle both even and odd cases?',
        'Did we use the modulo operator correctly?',
        'Did we test with different numbers?',
        'Did we consider negative numbers?',
        'Did we use meaningful variable names?',
        'Did we follow Java coding conventions?',
        'Did we add comments where necessary?',
        'Did we test our solution?',
        'Did we consider edge cases like zero?'
      ],
    },
  });

  // Create sample users
  const hashedPassword1 = await bcrypt.hash('password123', 10);
  const hashedPassword2 = await bcrypt.hash('password456', 10);

  await prisma.user.create({
    data: {
      id: 'user1',
      email: 'IT12345678@my.sliit.lk',
      password: hashedPassword1,
      firstName: 'John',
      lastName: 'Doe',
    },
  });

  await prisma.user.create({
    data: {
      id: 'user2',
      email: 'IT87654321@my.sliit.lk',
      password: hashedPassword2,
      firstName: 'Jane',
      lastName: 'Smith',
    },
  });

  console.log('Database seeded successfully!');
}

/*
 * ==================== WHAT WAS REMOVED FROM HERE ====================
 * seedMLData() used to insert a "productive" and a "driver dominance" session
 * with members, events, a feature_windows row, two pair_state_predictions at
 * 0.92 and 0.88 confidence, and an intervention.
 *
 * Those are not demo fixtures in a demo table. feature_windows and
 * pair_state_predictions ARE the research record - the feature/prediction
 * pairs kept so a human can label them later - and nothing on the rows said
 * they were invented. Anyone counting predictions, measuring calibration, or
 * annotating a corpus would have included them, and SessionsService.
 * getAllAnalytics even carried a comment describing them as real sessions.
 *
 * The feature window was also written with names from a retired scheme
 * (user1_edit_count_1m and friends), which the current 15-feature extractor
 * does not emit - so it could not have been used for training even by
 * accident, only for miscounting.
 *
 * If a populated analytics page is needed for a demonstration, play a session:
 * the prediction path runs every 30 events and on every failed run.
 * ====================================================================
 */

seedDatabase()
  .catch((e) => {
    console.error('Error seeding database:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

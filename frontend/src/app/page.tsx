import Link from 'next/link'

/**
 * PairPath's landing page.
 *
 * The "Get Started" button used to live in a `fixed left-0 top-0` <p> left over
 * from the create-next-app scaffold, pinned to the very top of the viewport.
 * That worked while nothing else was up there; the Code Guru bar now is, and
 * being fixed it sat underneath it and disappeared. It belongs in the page flow
 * next to the heading it relates to, which is also where a reader looks for it.
 *
 * The scaffold's decorative radial blurs went with it - they were violet and
 * pink, which is not the platform palette, and they framed a hero that no
 * longer exists.
 */
export default function Home() {
  return (
    <main className="min-h-screen px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12">
          <h1 className="text-4xl font-bold mb-3 text-surface-200">Pair Programming Platform</h1>
          <p className="text-lg text-surface-400 mb-8">
            Collaborative coding with AI-powered adaptive support
          </p>
          <Link
            href="/login"
            className="inline-block bg-primary-600 hover:bg-primary-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
          >
            Get Started
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-900 border border-surface-700 p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold mb-3 text-surface-200">Real-time Collaboration</h2>
            <p className="text-surface-400">
              Work together with your partner using shared code editor and live communication
            </p>
          </div>
          <div className="bg-surface-900 border border-surface-700 p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold mb-3 text-surface-200">Adaptive Support</h2>
            <p className="text-surface-400">
              AI-powered interventions help when you get stuck or need guidance
            </p>
          </div>
          <div className="bg-surface-900 border border-surface-700 p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold mb-3 text-surface-200">Java Practice</h2>
            <p className="text-surface-400">
              Improve your Java skills with structured pair programming exercises
            </p>
          </div>
          <div className="bg-surface-900 border border-surface-700 p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold mb-3 text-surface-200">Performance Analytics</h2>
            <p className="text-surface-400">
              Track your progress and get personalized recommendations
            </p>
          </div>
          <Link
            href="/ml-sandbox"
            className="bg-surface-900 p-6 rounded-lg shadow-sm border-2 border-surface-700 hover:border-primary-500 transition cursor-pointer"
          >
            <h2 className="text-xl font-semibold mb-3 text-primary-600">ML Sandbox 🧪</h2>
            <p className="text-surface-400">
              Test the XGBoost model predictions and RAG interventions manually
            </p>
          </Link>
          <Link
            href="/ml-analytics"
            className="bg-surface-900 p-6 rounded-lg shadow-sm border-2 border-surface-700 hover:border-primary-500 transition cursor-pointer"
          >
            <h2 className="text-xl font-semibold mb-3 text-primary-600">ML Analytics 📊</h2>
            <p className="text-surface-400">
              View detailed timelines and historical prediction data from sessions
            </p>
          </Link>
        </div>
      </div>
    </main>
  )
}

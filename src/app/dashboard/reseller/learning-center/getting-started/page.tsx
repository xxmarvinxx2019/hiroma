import Link from 'next/link'
import { gettingStartedCourse } from '@/app/lib/learningCenter/gettingStarted'

export default function GettingStartedPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-6 pb-10">
      <Link href="/dashboard/reseller/learning-center" className="inline-flex text-sm font-semibold text-[#9A741F] hover:underline">← Back to Learning Center</Link>

      <header className="overflow-hidden rounded-3xl bg-[#010521] px-6 py-8 text-white shadow-xl sm:px-10 sm:py-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#E5C56A]">Orientation course · Available now</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{gettingStartedCourse.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70">{gettingStartedCourse.description}</p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/10 px-3 py-1.5">6 verified lessons</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">About {gettingStartedCourse.estimatedMinutes} minutes</span>
          <span className="rounded-full bg-[#C9A84C] px-3 py-1.5 font-semibold text-[#0D1B3E]">Used by Hiro</span>
        </div>
      </header>

      <nav aria-label="Course lessons" className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-[#0D1B3E]">Course contents</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {gettingStartedCourse.lessons.map((lesson) => (
            <a key={lesson.id} href={`#${lesson.id}`} className="rounded-xl bg-[#F3F5FA] px-4 py-3 text-sm text-[#0D1B3E] transition hover:bg-[#E8ECF5]">
              <span className="mr-2 font-bold text-[#B48720]">{lesson.number}</span>{lesson.title}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-5">
        {gettingStartedCourse.lessons.map((lesson) => (
          <article id={lesson.id} key={lesson.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white shadow-sm">
            <div className="border-b border-[#0D1B3E]/8 bg-gradient-to-r from-[#F7F3E8] to-white px-5 py-5 sm:px-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B48720]">Lesson {lesson.number}</p>
              <h2 className="mt-2 text-xl font-semibold text-[#0D1B3E]">{lesson.title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">{lesson.summary}</p>
            </div>
            <div className="px-5 py-5 sm:px-7">
              <ul className="space-y-3">
                {lesson.points.map((point) => (
                  <li key={point} className="flex gap-3 text-sm leading-6 text-[#33405F]">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#C9A84C]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              {lesson.safetyNote && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>Safety note:</strong> {lesson.safetyNote}</div>}
              {lesson.action && <Link href={lesson.action.href} className="mt-5 inline-flex rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#162852]">{lesson.action.label} →</Link>}
            </div>
          </article>
        ))}
      </div>

      <section className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-[#0D1B3E]">Frequently asked questions</h2>
        <div className="mt-4 divide-y divide-[#0D1B3E]/10">
          {gettingStartedCourse.faqs.map((faq) => (
            <details key={faq.question} className="group py-4">
              <summary className="cursor-pointer list-none pr-8 text-sm font-semibold text-[#0D1B3E] marker:hidden">{faq.question}<span className="float-right text-[#C9A84C] group-open:rotate-45">+</span></summary>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-500">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-[#0D1B3E] p-5 text-white sm:p-7">
        <h2 className="text-xl font-semibold">Quick knowledge check</h2>
        <p className="mt-1 text-sm text-white/60">Open each question and confirm the safe, verified answer.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {gettingStartedCourse.quickChecks.map((item) => (
            <details key={item.question} className="rounded-xl bg-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[#F3D779]">{item.question}</summary>
              <p className="mt-3 text-sm leading-6 text-white/75">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-[#C9A84C]/30 bg-[#fffaf0] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <h2 className="font-semibold text-[#0D1B3E]">Need an explanation about this course?</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">Ask Hiro about any lesson. If Hiro cannot provide verified information, it can guide you to create a Support Ticket.</p>
        </div>
        <Link href="/dashboard/reseller/hiro" className="mt-4 inline-flex shrink-0 rounded-xl bg-[#C9A84C] px-4 py-2.5 text-xs font-semibold text-[#0D1B3E] sm:mt-0">Ask Hiro →</Link>
      </div>
    </section>
  )
}

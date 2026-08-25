export interface DailyInspiration {
  date: string
  text: string
  author: string
  source?: string
  category: 'Personal Growth' | 'Gratitude' | 'Leadership' | 'Resilience' | 'Motivation' | 'Faith & Hope' | 'Business & Entrepreneurship'
}

const ORIGINAL_REFLECTIONS: Omit<DailyInspiration, 'date'>[] = [
  { text: 'Small, consistent actions can quietly build an extraordinary life.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Your progress still matters, even when today feels slower than yesterday.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'A grateful heart notices opportunities that a hurried mind often misses.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'Lead with integrity when no one is watching; character is built in private.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'You do not need a perfect day to make one meaningful choice.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Rest is not giving up. It is preparing yourself to continue with purpose.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'Celebrate what is growing while patiently working on what still needs time.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'The best leaders help other people recognize the strength already within them.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'A better future begins with the next honest and responsible step.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Hard seasons can reveal strengths that comfortable seasons never require.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'Peace grows when you appreciate what you have while pursuing what matters.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'Your example will often speak more clearly than your instructions.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'Do today’s work with care; tomorrow’s confidence is built from it.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'A setback may change your route without changing your destination.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'Notice the people who make your journey lighter, and let them know they matter.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'Real leadership creates safety for truth, learning, and shared success.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'Discipline is choosing what supports your future, one decision at a time.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Courage does not remove uncertainty; it helps you move through it wisely.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'There is value in pausing long enough to recognize how far you have come.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'A strong team grows when credit is shared and responsibility is owned.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'Your mindset shapes the meaning you give to every challenge and opportunity.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Begin again without shame; wisdom often arrives through imperfect attempts.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'Gratitude turns ordinary moments into reminders that life still holds goodness.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'Influence becomes meaningful when it helps people grow beyond dependence.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'Focus on becoming dependable, not merely impressive.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'You can be tired and still be brave enough to take the next small step.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'What you appreciate today becomes part of the joy you remember tomorrow.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
  { text: 'Leadership begins with listening carefully before deciding confidently.', author: 'Hiroma Daily Reflection', category: 'Leadership' },
  { text: 'Growth becomes sustainable when your goals are supported by healthy habits.', author: 'Hiroma Daily Reflection', category: 'Personal Growth' },
  { text: 'Storms do not last forever, but the lessons you carry from them can.', author: 'Hiroma Daily Reflection', category: 'Resilience' },
  { text: 'A meaningful life is built not only by achievements, but by kindness along the way.', author: 'Hiroma Daily Reflection', category: 'Gratitude' },
]

const REFLECTION_SEEDS: { text: string; category: DailyInspiration['category'] }[] = [
  { text: 'Your future is shaped by the courage you practice today.', category: 'Motivation' },
  { text: 'Even quiet progress is proof that you have not given up.', category: 'Resilience' },
  { text: 'You are allowed to grow at a pace that protects your peace.', category: 'Personal Growth' },
  { text: 'Hope gives your effort a reason to continue before results appear.', category: 'Faith & Hope' },
  { text: 'A leader’s strength is measured by the confidence they build in others.', category: 'Leadership' },
  { text: 'A trustworthy business is built when every promise to a customer is treated as a responsibility.', category: 'Business & Entrepreneurship' },
  { text: 'Gratitude reminds you that an unfinished journey can still be beautiful.', category: 'Gratitude' },
  { text: 'Your hardest chapter does not have the authority to write your ending.', category: 'Resilience' },
  { text: 'Purpose grows clearer when your daily choices agree with your values.', category: 'Motivation' },
  { text: 'Faith can be the calm decision to keep moving without seeing the whole road.', category: 'Faith & Hope' },
  { text: 'People remember leaders who make them feel seen, heard, and capable.', category: 'Leadership' },
  { text: 'A small promise kept to yourself can rebuild powerful confidence.', category: 'Personal Growth' },
  { text: 'There is always something worth appreciating, even on an imperfect day.', category: 'Gratitude' },
  { text: 'Pressure may test your strength, but it can also reveal your preparation.', category: 'Resilience' },
  { text: 'Consistent follow-up turns customer interest into relationships without using pressure.', category: 'Business & Entrepreneurship' },
  { text: 'Trust that patient preparation is still movement toward the right opportunity.', category: 'Faith & Hope' },
  { text: 'Leadership is service made visible through responsible action.', category: 'Leadership' },
  { text: 'You become more capable each time you choose learning over embarrassment.', category: 'Personal Growth' },
  { text: 'The people who support your growth are part of your life’s quiet wealth.', category: 'Gratitude' },
  { text: 'You have survived days that once felt impossible to finish.', category: 'Resilience' },
  { text: 'Motivation may begin the journey, but commitment carries it forward.', category: 'Motivation' },
  { text: 'Some answers arrive only after patience has strengthened your heart.', category: 'Faith & Hope' },
  { text: 'Good leaders correct with respect and recognize effort with sincerity.', category: 'Leadership' },
  { text: 'Healthy cash discipline helps a growing business protect tomorrow’s opportunities.', category: 'Business & Entrepreneurship' },
  { text: 'A thankful perspective can turn enough into abundance.', category: 'Gratitude' },
  { text: 'Being challenged does not mean you are failing; it may mean you are expanding.', category: 'Resilience' },
  { text: 'A sale becomes meaningful when the product genuinely serves the customer’s need.', category: 'Business & Entrepreneurship' },
  { text: 'Believe that your honest work is preparing room for something meaningful.', category: 'Faith & Hope' },
  { text: 'A leader earns trust by making values visible in difficult decisions.', category: 'Leadership' },
  { text: 'Self-respect grows when your choices honor the person you hope to become.', category: 'Personal Growth' },
  { text: 'Joy often enters through the simple things you finally pause to notice.', category: 'Gratitude' },
  { text: 'You can bend under pressure without allowing it to define your direction.', category: 'Resilience' },
  { text: 'Your dream deserves more than wishing; it deserves a plan and a next step.', category: 'Motivation' },
  { text: 'When the path is unclear, hold on to hope and act on what you know is right.', category: 'Faith & Hope' },
  { text: 'Leadership grows when humility and confidence learn to work together.', category: 'Leadership' },
  { text: 'Preparation, product knowledge, and honest communication make confidence credible.', category: 'Business & Entrepreneurship' },
  { text: 'Gratitude does not ignore difficulty; it refuses to let difficulty hide every blessing.', category: 'Gratitude' },
  { text: 'Every recovery begins with believing that one more attempt is worthwhile.', category: 'Resilience' },
  { text: 'Business reputation grows through many small transactions handled with care and integrity.', category: 'Business & Entrepreneurship' },
  { text: 'A hopeful heart can recognize possibilities that fear has overlooked.', category: 'Faith & Hope' },
  { text: 'The most lasting influence is built through fairness, patience, and example.', category: 'Leadership' },
  { text: 'Improvement begins when excuses are replaced by honest reflection.', category: 'Personal Growth' },
  { text: 'Thankfulness keeps success grounded and struggle from becoming empty.', category: 'Gratitude' },
  { text: 'A difficult beginning can still lead to a strong and meaningful outcome.', category: 'Resilience' },
  { text: 'Entrepreneurs who keep learning can adapt before changing conditions become permanent problems.', category: 'Business & Entrepreneurship' },
  { text: 'Have faith that unseen growth is still taking place beneath patient effort.', category: 'Faith & Hope' },
  { text: 'A leader does not need every answer, but must remain honest enough to seek one.', category: 'Leadership' },
  { text: 'Clear records and responsible inventory protect both the business and the people accountable for it.', category: 'Business & Entrepreneurship' },
  { text: 'The habit of noticing good things makes ordinary days feel richer.', category: 'Gratitude' },
  { text: 'What feels like delay may be giving you time to become ready.', category: 'Resilience' },
  { text: 'Long-term growth comes from creating value repeatedly, not chasing one impressive transaction.', category: 'Business & Entrepreneurship' },
  { text: 'Keep hope alive by remembering that circumstances can change faster than expected.', category: 'Faith & Hope' },
  { text: 'Strong leaders create clarity without taking dignity away from others.', category: 'Leadership' },
  { text: 'The quality of your questions can improve the direction of your life.', category: 'Personal Growth' },
  { text: 'Appreciation turns relationships from familiar into meaningful again.', category: 'Gratitude' },
  { text: 'You are more than the disappointment you are currently processing.', category: 'Resilience' },
  { text: 'Listening carefully is one of the most practical ways to understand a market and serve it better.', category: 'Business & Entrepreneurship' },
  { text: 'Faith invites you to prepare for good things without demanding certainty.', category: 'Faith & Hope' },
  { text: 'Leadership is proven when responsibility is accepted before recognition is requested.', category: 'Leadership' },
  { text: 'A wiser version of you is being formed through every honest lesson.', category: 'Personal Growth' },
  { text: 'Gratitude lets your heart rest without making your ambition disappear.', category: 'Gratitude' },
  { text: 'You can carry the lesson forward without carrying the pain forever.', category: 'Resilience' },
  { text: 'Your goals need your participation more than they need perfect conditions.', category: 'Motivation' },
  { text: 'Something good can be developing even while your season feels uncertain.', category: 'Faith & Hope' },
  { text: 'Leaders multiply progress when they teach others how to decide well.', category: 'Leadership' },
  { text: 'The courage to change direction can be as important as the courage to begin.', category: 'Personal Growth' },
  { text: 'A grateful spirit makes room for contentment without settling for less than growth.', category: 'Gratitude' },
]

const originalSet = (
  category: DailyInspiration['category'],
  text: string,
): Omit<DailyInspiration, 'date'>[] => text.trim().split('\n').map((line) => ({
  text: line.trim(), author: 'Hiroma Daily Reflection', category,
}))

// Every line below is a complete reflection. Deliberately avoid generated
// prefix/suffix combinations so the voice and cadence do not repeat by design.
const STANDALONE_REFLECTIONS: Omit<DailyInspiration, 'date'>[] = [
  ...originalSet('Business & Entrepreneurship', `
A customer may forget the sales pitch, but they remember whether you listened.
Good business begins with a real problem worth solving.
Keep promises small enough to honor and meaningful enough to matter.
Revenue is exciting; healthy cash flow keeps the doors open.
The clearest offer is often the easiest one to trust.
Ask what the customer needs before explaining what you sell.
An honest no can protect a relationship better than a careless yes.
Every receipt tells part of the story of your business.
Busy does not always mean profitable; review the numbers calmly.
Your reputation arrives before you do when customers share their experience.
Stock on a shelf is money waiting for a responsible decision.
A simple process followed well beats a complicated process ignored.
Treat the smallest buyer with the same care as the largest account.
Make it easy for people to understand the value, not just the price.
The best follow-up feels helpful, never desperate.
Before expanding, make sure the foundation can carry the growth.
Profit gives a business room to serve again tomorrow.
A missed target is information; study it before setting the next one.
Great service often looks like doing the ordinary things reliably.
Learn the customer’s language instead of making them learn yours.
There is courage in adjusting a plan that the evidence no longer supports.
Build systems that still work on the days motivation is low.
Discounts can win attention, but trust wins returning customers.
A clean record today prevents a difficult explanation later.
If the team understands why the work matters, quality becomes easier to protect.
Selling with integrity means being willing to lose the wrong sale.
Small improvements in service can become large reasons to return.
Know what each sale costs before celebrating what it earns.
The business grows stronger when feedback can travel upward without fear.
Do not confuse a crowded market with a market that has no room for excellence.
Customers notice when care continues after payment.
Consistency turns a new business into a dependable one.
  `),
  ...originalSet('Business & Entrepreneurship', `
Write the plan clearly enough that another person can carry it forward.
A product earns loyalty when its promise matches the experience.
Cash handled carefully is trust made visible.
Some opportunities become expensive because nobody asked the second question.
The right metric helps; the wrong metric merely looks impressive.
Make decisions from records, not from the loudest guess in the room.
Growth without accountability can hide losses until they become painful.
The strongest brands sound human because they pay attention to humans.
Train for the standard you want customers to experience.
One thoughtful improvement can remove a hundred repeated frustrations.
Price explains the cost; service helps people understand the worth.
Entrepreneurship includes the humility to begin with what you have.
When demand rises, protect quality before chasing volume.
Inventory counted honestly is better than inventory estimated confidently.
Do not let urgency turn a temporary shortcut into a permanent habit.
A respectful complaint is a free lesson from someone who still cares.
The easiest customer to keep is the one you continue to value.
Partnership works when responsibilities are as clear as rewards.
Measure what matters, then make time to understand what the measure means.
The work behind the counter shapes the promise made in front of it.
A reliable supplier protects more than stock; they protect customer confidence.
Before adding another task, ask which task can be made simpler.
Good selling connects the right person with the right solution.
Your first version needs honesty and learning more than perfection.
When a mistake happens, speed, truth, and ownership rebuild trust.
A sustainable business leaves room for people to rest and improve.
Leadership in business is visible in the details no advertisement can show.
Be curious about why people return and why others do not.
The next useful idea may come from the person closest to the daily work.
Long-term value grows when transactions become relationships.
Success becomes healthier when the team can share both credit and truth.
Build something you would be proud to explain to your family.
  `),
  ...originalSet('Personal Growth', `
Not every lesson needs to become a lifelong regret.
You can outgrow an old version of yourself without hating who you were.
What deserves more of your attention today?
Confidence often arrives after the attempt, not before it.
Protect a little quiet in your day; clarity needs somewhere to land.
Your calendar eventually reveals what your intentions only promised.
It is okay to be a beginner in a room full of experience.
Change feels less frightening when you name the first practical step.
You do not have to answer every opinion about your life.
Sometimes maturity sounds like, “I was wrong, and I will repair it.”
The life you want is also shaped by what you learn to decline.
Take your own goals seriously enough to give them time.
Comparison can hide the progress that belongs only to your journey.
One honest conversation with yourself can change a month of decisions.
Make room for joy that does not need to be earned.
Your worth is larger than today’s productivity.
A new habit becomes believable each time you return to it.
You may need a better routine, not a harsher opinion of yourself.
What would you try if learning were allowed to look awkward?
Let your standards guide you without turning them into punishment.
The boundary you communicate clearly can protect a valuable relationship.
Growth is not always visible from the outside.
Keep a promise to yourself today, even a small one.
You are not late to a life that is still yours to shape.
Wisdom sometimes enters as a pause before an old reaction.
Choose the kind of tired that comes from meaningful effort.
Your attention is part of your life; spend it with care.
There is strength in asking for help before everything becomes heavy.
Becoming dependable is a quiet form of confidence.
You can want more for your life and still appreciate where you are.
Leave room for your plans to become wiser.
The next chapter does not require permission from the last one.
  `),
  ...originalSet('Gratitude', `
Some of life’s richest moments never appear on a receipt.
Notice who checks on you without needing to be asked.
Today may be ordinary, and ordinary can still be precious.
Gratitude is remembering that help has had many faces.
Pause long enough to enjoy what you once prayed would become normal.
A shared meal can hold more wealth than an expensive room.
Thank the person whose quiet work makes your day easier.
There is comfort in recognizing what remained when other things changed.
Your body has carried you through every difficult day so far.
Appreciation becomes more meaningful when it is spoken aloud.
The sunrise does not ask whether yesterday was productive.
Some blessings arrive disguised as people who tell us the truth.
Celebrate the progress that did not need an audience.
The chance to begin again is already something to value.
Gratitude does not shrink your dreams; it softens the journey toward them.
Remember the hands that helped when your own felt tired.
There is abundance in having someone with whom silence feels safe.
A useful lesson can be a gift even when it was expensive.
What felt small today but made life a little kinder?
Do not wait for a farewell to tell people what they mean to you.
The ability to learn is a resource worth thanking life for.
Even a difficult season can contain one honest kindness.
Home is often made from routines we barely notice until they change.
Thankfulness gives ordinary effort a place in the heart.
The people growing beside you are part of the achievement.
Sometimes enough is a peaceful meal and a mind allowed to rest.
Look again; the day may have offered goodness quietly.
Receive sincere help without turning it into a debt in your heart.
You can be grateful for the lesson without wanting the pain again.
Every safe arrival deserves a moment of thanks.
Joy becomes easier to remember when we name it while it is here.
Let appreciation interrupt the habit of always wanting the next thing.
  `),
  ...originalSet('Leadership', `
People need clear direction, but they also need room to think.
A title can assign authority; behavior earns trust.
The leader who listens early avoids correcting too late.
Give feedback about the work without attacking the person.
If only one voice feels safe, the team is not truly speaking.
Credit shared sincerely does not make a leader smaller.
Decisions become stronger when the people affected can be heard.
Hold the standard firmly and the conversation respectfully.
Good leaders do not create dependence; they develop judgment in others.
Apologizing in front of the team can teach more than pretending perfection.
Clarity is a kindness when expectations carry consequences.
Ask yourself whether your silence is protecting peace or avoiding responsibility.
The culture follows what leaders tolerate repeatedly.
Before demanding ownership, make sure people have real authority to act.
A calm leader can keep one problem from becoming five.
Notice the dependable person whose work rarely asks for attention.
Leadership is also deciding which burden should not reach the team.
People learn courage when truth is received without humiliation.
An instruction explains what; context helps people understand why.
Fairness is not sameness—it is consistency guided by understanding.
The best meeting ends with clear owners and clear next steps.
Lead the person in front of you, not an imaginary perfect employee.
Recognition is most powerful when it is specific and timely.
A leader’s private habits eventually become a team’s public reality.
Do not ask for honesty and then punish every uncomfortable answer.
Strong teams can disagree without questioning one another’s dignity.
When pressure rises, return to principles before personalities.
Responsibility means staying present after the decision is made.
Teach what you know, and remain teachable about what you do not.
Leadership is not being needed everywhere; it is helping others become ready.
Trust grows when words, records, and actions tell the same story.
Leave people more capable than when they first worked with you.
  `),
  ...originalSet('Resilience', `
You are allowed to catch your breath without calling it defeat.
Some days the brave choice is simply not to quit tonight.
Healing may be quiet and still be real.
The road can be different from the plan and still lead somewhere good.
You have handled uncertainty before, one day at a time.
Do not make a permanent judgment while carrying temporary exhaustion.
A closed door can hurt without proving that every door is closed.
Begin with what remains, not only with what was lost.
Your pace can slow while your direction stays true.
There is no shame in rebuilding carefully.
One disappointing result cannot summarize all your ability.
Let the difficult day end; it does not need to follow you forever.
Strength is sometimes choosing tenderness after life has been hard.
You can miss what was and still move toward what may be.
The comeback often starts before anyone else can see it.
When the whole staircase feels heavy, attend to the next step only.
You do not need to feel fearless to act with courage.
The lesson can remain after the wound stops leading your choices.
Give tomorrow the chance that today could not offer.
Progress after pain may look different, but it still counts.
Ask for support before isolation begins to sound reasonable.
What bent you did not necessarily break you.
Patience with recovery is also a form of discipline.
You can restart without returning to the beginning.
A bad hour does not own the rest of the day.
Carry forward the wisdom, not every weight.
Your story contains more than the chapter that exhausted you.
Rest can be part of resistance against giving up.
The plan failed; your capacity to create another plan did not.
Keep one small reason nearby when larger reasons feel distant.
The person you are becoming knows how hard this has been.
Hope can be quiet and still keep the light on.
  `),
  ...originalSet('Motivation', `
Start before the mood arrives.
Your goal cannot meet the version of you who never begins.
Make the next move small enough to do now.
One focused hour can rescue a distracted day.
Do the work that makes tomorrow less anxious.
Momentum likes a clear decision.
The dream becomes more respectful when it receives a schedule.
You do not need more pressure; you may need a clearer priority.
Finish one meaningful thing before collecting five new intentions.
Action can answer questions that thinking alone keeps repeating.
The first attempt is allowed to be useful rather than impressive.
If it matters, give it a place on the calendar.
Return to the reason, then return to the work.
Let progress be visible in completed steps, not only in busy hours.
You have enough time for the next responsible action.
Aim for a day you can respect, not a day you can boast about.
The distance changes when you stop negotiating with the first step.
Preparation turns opportunity from surprise into possibility.
Give your best energy to work that deserves it.
The task feels different once it is no longer untouched.
Do not wait to feel ready for work that will help you become ready.
Consistency is ambition that learned how to return tomorrow.
Choose a target your actions can recognize.
There is power in completing what no one is applauding yet.
Make fewer promises and keep more of them.
The next thirty minutes still belong to you.
Turn the idea into a date, a person, and a first action.
You can be patient with results and urgent about effort.
A written goal asks better questions of your day.
Begin where excuses become specific choices.
Effort gains direction when the outcome is clearly defined.
Your future will be shaped by many ordinary Tuesdays.
Motivation becomes trustworthy when it survives an ordinary day.
  `),
  ...originalSet('Faith & Hope', `
Hope is not denial; it is refusing to let fear make every prediction.
You can trust the next step without seeing the whole journey.
Faith sometimes sounds like a quiet yes in an uncertain room.
Leave space for life to surprise you kindly.
The answer may be forming in ways you cannot measure yet.
Hold on to what is true when feelings become loud.
Hope gives the heart somewhere to face.
You are not forgotten in a season that feels slow.
Some waiting rooms are also places of preparation.
Let prayer make room for courage, not only comfort.
The light you need may be enough for today, not the whole road.
Trust can grow through questions that remain honest.
There are mornings ahead that this difficult night cannot imagine.
Faith does not forbid planning; it gives planning a deeper reason.
Keep your heart open without pretending disappointment does not hurt.
Sometimes peace arrives before the explanation.
What is delayed is not automatically denied.
Hope can coexist with a tired heart.
You may not control the timing, but you can protect your integrity while waiting.
Let uncertainty teach patience without teaching despair.
There is meaning in doing good before results become visible.
Your life can still open into something you have not pictured.
Faith carries questions without requiring them to disappear overnight.
The seed is not failing because the field looks quiet.
When certainty is absent, kindness remains a trustworthy direction.
Give the unknown less authority than the values you already know.
The future has not finished introducing itself.
Believe in restoration without rushing the work it requires.
Hope is a companion for action, not a substitute for it.
You can prepare faithfully while leaving room for grace.
Let today’s courage be enough for today.
Even now, a new way forward may be taking shape.
  `),
]

const PUBLIC_DOMAIN_QUOTES: Omit<DailyInspiration, 'date'>[] = [
  { text: 'Optimism is the faith that leads to achievement; nothing can be done without hope.', author: 'Helen Keller', source: 'Optimism', category: 'Faith & Hope' },
  { text: 'Nothing great was ever achieved without enthusiasm.', author: 'Ralph Waldo Emerson', source: 'Essays, First Series', category: 'Motivation' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin', source: 'Poor Richard’s Almanack', category: 'Leadership' },
  { text: 'If there is no struggle, there is no progress.', author: 'Frederick Douglass', source: 'West India Emancipation speech', category: 'Resilience' },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin', source: 'Poor Richard’s Almanack', category: 'Personal Growth' },
  { text: 'Our greatest glory is not in never falling, but in rising every time we fall.', author: 'Oliver Goldsmith', source: 'The Citizen of the World', category: 'Resilience' },
  { text: 'The only way to have a friend is to be one.', author: 'Ralph Waldo Emerson', source: 'Essays, First Series', category: 'Gratitude' },
  { text: 'He that can have patience can have what he will.', author: 'Benjamin Franklin', source: 'Poor Richard’s Almanack', category: 'Resilience' },
  { text: 'Write it on your heart that every day is the best day in the year.', author: 'Ralph Waldo Emerson', source: 'Works and Days', category: 'Gratitude' },
  { text: 'The heights by great men reached and kept were not attained by sudden flight.', author: 'Henry Wadsworth Longfellow', source: 'The Ladder of St. Augustine', category: 'Motivation' },
]

export const CURATED_QUOTES: Omit<DailyInspiration, 'date'>[] = [
  ...ORIGINAL_REFLECTIONS,
  ...REFLECTION_SEEDS.map((reflection) => ({ ...reflection, author: 'Hiroma Daily Reflection' })),
  ...STANDALONE_REFLECTIONS,
  ...PUBLIC_DOMAIN_QUOTES,
]

export function getManilaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

const DAILY_CYCLE_EPOCH = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 86_400_000)
const shuffledCycles = new Map<number, typeof CURATED_QUOTES>()

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function getShuffledCycle(cycleNumber: number) {
  const cached = shuffledCycles.get(cycleNumber)
  if (cached) return cached

  const shuffled = [...CURATED_QUOTES]
  const random = seededRandom(0x4849524F ^ Math.imul(cycleNumber + 1, 0x9E3779B1))
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  shuffledCycles.set(cycleNumber, shuffled)
  return shuffled
}

export function getDailyInspiration(date = new Date()): DailyInspiration {
  const manilaDate = getManilaDate(date)
  const dayNumber = Math.floor(Date.parse(`${manilaDate}T00:00:00Z`) / 86_400_000)
  const relativeDay = dayNumber - DAILY_CYCLE_EPOCH
  const cycleNumber = Math.floor(relativeDay / CURATED_QUOTES.length)
  const dayInCycle = ((relativeDay % CURATED_QUOTES.length) + CURATED_QUOTES.length) % CURATED_QUOTES.length
  return { date: manilaDate, ...getShuffledCycle(cycleNumber)[dayInCycle] }
}

export function getRecentInspirations(days = 7, date = new Date()) {
  const manilaDate = getManilaDate(date)
  const anchor = Date.parse(`${manilaDate}T00:00:00Z`)
  return Array.from({ length: Math.max(1, Math.min(days, 31)) }, (_, index) =>
    getDailyInspiration(new Date(anchor - index * 86_400_000)),
  )
}

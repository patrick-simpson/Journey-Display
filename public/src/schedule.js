// Daily schedule: full-screen the Awana Check-in Display all day, except
// between JOURNEY_START and JOURNEY_END, when the Journey placeholder shows.
// See CLAUDE.md for the conventions around changing these constants.
const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
const JOURNEY_END_MINUTES = 19 * 60 + 15; // 7:15 PM
const POLL_INTERVAL_MS = 15000;

const checkinView = document.getElementById('checkin-view');
const journeyView = document.getElementById('journey-view');
const toggleBtn = document.getElementById('toggle-btn');

function scheduledPhase() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= JOURNEY_START_MINUTES && minutes < JOURNEY_END_MINUTES
    ? 'journey'
    : 'checkin';
}

function setView(phase) {
  const showJourney = phase === 'journey';
  journeyView.classList.toggle('hidden', !showJourney);
  checkinView.classList.toggle('hidden', showJourney);
}

let lastPhase = scheduledPhase();
setView(lastPhase);

setInterval(() => {
  const phase = scheduledPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    setView(phase);
  }
}, POLL_INTERVAL_MS);

toggleBtn.addEventListener('click', () => {
  const showingJourney = !journeyView.classList.contains('hidden');
  setView(showingJourney ? 'checkin' : 'journey');
});

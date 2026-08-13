import type { ScheduleCandidate } from "./ScheduleLabPage";

type CandidateComparisonProps = {
  candidates: readonly ScheduleCandidate[];
  selectedId: string | null;
  onSelect(candidateId: string): void;
};

const scoreHeadings = [
  "Invalid heats",
  "Appearance imbalance",
  "Repeat excess",
  "Maximum pair frequency",
  "Worst repeat burden",
  "Squared repeat burden",
  "Squared pair frequency",
  "Consecutive byes",
  "Immediate repeat opponents",
  "Stable opponent key",
] as const;

export function CandidateComparison({ candidates, selectedId, onSelect }: CandidateComparisonProps) {
  if (candidates.length === 0) return null;
  return (
    <div className="schedule-table-scroll">
      <table className="candidate-comparison" aria-label="Schedule candidate comparison">
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Explicit seed</th>
            {scoreHeadings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => (
            <tr key={candidate.id}>
              <td>
                <label className="candidate-choice">
                  <input
                    type="radio"
                    name="schedule-candidate"
                    checked={selectedId === candidate.id}
                    onChange={() => onSelect(candidate.id)}
                  />
                  Choose candidate {index + 1}
                </label>
              </td>
              <td>{candidate.seed}</td>
              {candidate.score.map((term, termIndex) => <td key={`${candidate.id}-${scoreHeadings[termIndex]}`}>{term}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="feature-note">Candidates are compared left to right. No scalar fairness score hides a worse earlier objective.</p>
    </div>
  );
}

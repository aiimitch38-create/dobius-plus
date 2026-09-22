// Blank home screen: the Buzz gradient canvas (buzz-skin.css `.buzz-page`,
// light + dark stops) with a white D+ centered. Replaces the Command Center
// content in the 'manager' view.
export default function HomePage(): React.JSX.Element {
  return (
    <div className="buzz-page absolute inset-0 flex items-center justify-center">
      <span
        aria-label="Dobius+"
        className="select-none text-8xl font-bold tracking-tight text-white"
      >
        D+
      </span>
    </div>
  )
}

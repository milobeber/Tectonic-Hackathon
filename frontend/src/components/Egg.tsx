// The egg a new swan hatches from. Same coordinate frame as <Swan> (0 0 330 240, waterline 196).
export function Egg() {
  return (
    <g className="egg">
      <defs>
        <linearGradient id="egg-fill" x1="130" y1="100" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a5372" />
          <stop offset="0.55" stopColor="#0c0c1e" />
        </linearGradient>
      </defs>
      <g className="egg-wobble">
        <path d="M 168 198 C 138 198, 132 166, 140 142 C 148 118, 160 106, 168 106 C 176 106, 188 118, 196 142 C 204 166, 198 198, 168 198 Z" fill="url(#egg-fill)" />
        <path d="M 150 140 C 154 126, 160 116, 166 112" stroke="#8a80a3" strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.7} />
        <path d="M 144 152 L 154 146 L 160 154 L 170 144 L 178 152 L 188 146 L 194 152" stroke="#f7d63e" strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      <path d="M 110 197 C 140 194, 196 194, 226 198 C 196 197.5, 140 197.5, 110 197 Z" fill="#0c0c1e" opacity={0.5} />
    </g>
  )
}

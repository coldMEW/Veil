import { motion, type MotionValue, useTransform } from 'motion/react';

/**
 * The woman on the sofa, drawn flat in greys. `scream` (0..1) moves her from reading her phone
 * to the moment she sees the fake: eyes open, mouth opens, hands fly to her face.
 */
export function Woman({ scream }: { scream: MotionValue<number> }) {
  const calm = useTransform(scream, [0, 0.35], [1, 0]);
  const shock = useTransform(scream, [0.25, 0.6], [0, 1]);
  const jolt = useTransform(scream, [0, 0.4, 0.55, 1], [0, -16, -10, -12]);
  const mouthRy = useTransform(scream, [0.2, 0.7], [1, 17]);
  const mouthRx = useTransform(scream, [0.2, 0.7], [8, 11]);
  const eye = useTransform(scream, [0.2, 0.6], [2.5, 6]);
  const brow = useTransform(scream, [0.2, 0.6], [0, -8]);
  const linesScale = useTransform(scream, [0.4, 1], [0.6, 1.08]);
  const linesOpacity = useTransform(scream, [0.4, 0.6], [0, 1]);

  return (
    <motion.g style={{ y: jolt }}>
      {/* hair, behind the head */}
      <path d="M778 452 C770 405 800 380 836 380 C878 380 902 410 896 456 L904 572 L766 572 Z" fill="#0d0d0d" />
      {/* legs: thighs on the seat, shins to the floor */}
      <path d="M800 640 L930 640 Q952 640 952 662 L952 690 L800 690 Z" fill="#161616" />
      <path d="M906 662 L952 662 L960 880 L922 880 Z" fill="#161616" />
      <path d="M866 662 L910 662 L914 880 L876 880 Z" fill="#1b1b1b" />
      <path d="M914 872 L978 872 Q986 872 986 884 L986 892 L914 892 Z" fill="#e9e9e4" />
      <path d="M872 872 L934 872 Q942 872 942 884 L942 892 L872 892 Z" fill="#d6d6d0" />
      {/* sweater */}
      <path d="M788 520 Q790 500 812 498 L866 498 Q888 500 890 522 L896 664 L784 664 Z" fill="#dcdcd6" />
      <path d="M816 498 L862 498 L852 516 Q839 524 826 516 Z" fill="#bdbdb6" />
      {/* neck and head */}
      <rect x="826" y="478" width="26" height="30" rx="6" fill="#a9a9a3" />
      <circle cx="839" cy="446" r="44" fill="#b9b9b3" />
      {/* fringe */}
      <path d="M796 440 C796 400 826 388 850 392 C874 396 886 414 884 430 C860 418 830 420 806 446 Z" fill="#0d0d0d" />

      {/* calm face: looking down at the phone */}
      <motion.g style={{ opacity: calm }}>
        <path d="M818 452 q6 4 12 0" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M848 452 q6 4 12 0" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M832 474 q8 3 16 0" stroke="#5a5a55" strokeWidth="3" fill="none" strokeLinecap="round" />
      </motion.g>

      {/* shocked face */}
      <motion.g style={{ opacity: shock }}>
        <motion.g style={{ y: brow }}>
          <path d="M814 432 q9 -6 18 -1" stroke="#0d0d0d" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M846 431 q9 -5 18 1" stroke="#0d0d0d" strokeWidth="4" fill="none" strokeLinecap="round" />
        </motion.g>
        <circle cx="824" cy="449" r="9" fill="#f5f5f2" />
        <circle cx="855" cy="449" r="9" fill="#f5f5f2" />
        <motion.circle cx="824" cy="450" r={eye} fill="#0d0d0d" />
        <motion.circle cx="855" cy="450" r={eye} fill="#0d0d0d" />
        <motion.ellipse cx="839" cy="478" rx={mouthRx} ry={mouthRy} fill="#0d0d0d" />
      </motion.g>

      {/* arms: holding the phone up (calm) */}
      <motion.g style={{ opacity: calm }}>
        <path d="M792 528 Q770 590 800 616 L880 584 L872 562 L812 586 Q806 560 812 532 Z" fill="#cfcfc9" />
        <path d="M886 528 Q906 584 892 604 L868 600 Q878 570 866 534 Z" fill="#cfcfc9" />
        <circle cx="880" cy="574" r="12" fill="#a9a9a3" />
      </motion.g>

      {/* arms: hands up at the face (shock) */}
      <motion.g style={{ opacity: shock }}>
        <path d="M790 530 Q760 520 772 470 L790 466 Q790 500 804 520 Z" fill="#cfcfc9" />
        <path d="M888 530 Q918 520 906 470 L888 466 Q888 500 874 520 Z" fill="#cfcfc9" />
        <ellipse cx="788" cy="458" rx="14" ry="20" fill="#a9a9a3" />
        <ellipse cx="890" cy="458" rx="14" ry="20" fill="#a9a9a3" />
      </motion.g>

      {/* scream lines */}
      <motion.g style={{ opacity: linesOpacity, scale: linesScale, originX: '839px', originY: '446px' }} stroke="#f5f5f2" strokeWidth="6" strokeLinecap="round">
        <line x1="760" y1="372" x2="738" y2="346" />
        <line x1="839" y1="352" x2="839" y2="318" />
        <line x1="918" y1="372" x2="940" y2="346" />
        <line x1="740" y1="430" x2="708" y2="424" />
        <line x1="938" y1="430" x2="970" y2="424" />
      </motion.g>
    </motion.g>
  );
}

/** Her face as it appears in the fake posts: same drawing language, cropped to a portrait. */
export function FacePortrait({ bg, outfit, accent }: { bg: string; outfit: string; accent?: string }) {
  return (
    <svg viewBox="0 0 320 320" role="img" aria-label="A fake picture made with her face" preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="320" fill={bg} />
      {accent && <circle cx="250" cy="70" r="40" fill={accent} />}
      <path d="M96 150 C88 80 128 52 166 52 C214 52 238 92 230 150 L242 320 L84 320 Z" fill="#0d0d0d" />
      <path d="M90 320 Q92 236 160 230 Q228 236 232 320 Z" fill={outfit} />
      <rect x="146" y="196" width="30" height="40" rx="8" fill="#a9a9a3" />
      <circle cx="161" cy="150" r="58" fill="#b9b9b3" />
      <path d="M104 140 C104 92 140 80 168 84 C200 88 214 110 212 128 C180 112 140 116 112 150 Z" fill="#0d0d0d" />
      <circle cx="141" cy="154" r="4.5" fill="#1a1a1a" />
      <circle cx="181" cy="154" r="4.5" fill="#1a1a1a" />
      <path d="M144 182 q17 10 34 0" stroke="#3a3a35" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

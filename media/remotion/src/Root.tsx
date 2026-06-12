import React from 'react';
import { Composition } from 'remotion';
import { GovernanceLoop, LOOP_DURATION_FRAMES, FPS } from './GovernanceLoop';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="GovernanceLoop"
      component={GovernanceLoop}
      durationInFrames={LOOP_DURATION_FRAMES}
      fps={FPS}
      width={960}
      height={540}
    />
  );
};

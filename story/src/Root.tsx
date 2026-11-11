import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import { Cover } from "./Cover";
import { Turn, TurnPets } from "./Turn";
import { CustomCheck, LIB_FRAMES, Library } from "./Check";
import { CAST } from "./rig/cast";
import { DUR, FPS } from "./kit/ui";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={DUR} fps={FPS} width={1080} height={1920} />
    <Composition id="Cover" component={Cover} durationInFrames={DUR} fps={FPS} width={1080} height={1920} />
    {Object.keys(CAST).map((who) => <Composition key={who} id={`Turn-${who}`} component={Turn} defaultProps={{ who }} durationInFrames={30} fps={FPS} width={1080} height={1920} />)}
    <Composition id="Library" component={Library} durationInFrames={LIB_FRAMES} fps={FPS} width={1080} height={1920} />
    <Composition id="CustomCheck" component={CustomCheck} durationInFrames={3} fps={FPS} width={1080} height={1920} />
    <Composition id="Turn-pets" component={TurnPets} durationInFrames={30} fps={FPS} width={1080} height={1920} />
  </>
);

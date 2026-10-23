"use client";

import { Alignment, Fit, Layout, useRive } from "@rive-app/react-canvas";

const layout = new Layout({
  fit: Fit.Contain,
  alignment: Alignment.Center,
});

export default function DogMascot() {
  const { RiveComponent } = useRive({
    src: "/rive/dog-mascot.riv",
    artboard: "Artboard",
    stateMachine: "State Machine 1",
    autoplay: true,
    layout,
  });

  return (
    <div className="dog-mascot" aria-hidden="true">
      <RiveComponent />
    </div>
  );
}

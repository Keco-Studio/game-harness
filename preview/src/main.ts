import { Engine, Actor, Color, Vector, DisplayMode } from "excalibur";
import { heroAnimations, heroAnchor } from "./animations";

const engine = new Engine({
  canvasElementId: "game",
  displayMode: DisplayMode.FillScreen,
  backgroundColor: Color.fromHex("#222"),
  pixelArt: true,
  antialiasing: false,
});

const actor = new Actor({
  pos: new Vector(engine.drawWidth / 2, engine.drawHeight / 2),
  width: 64,
  height: 64,
  anchor: new Vector(heroAnchor.x, heroAnchor.y),
});
actor.graphics.use(heroAnimations.idle);
engine.add(actor);

document.querySelectorAll<HTMLButtonElement>("button[data-anim]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.anim as keyof typeof heroAnimations;
    actor.graphics.use(heroAnimations[name]);
  });
});

engine.start();

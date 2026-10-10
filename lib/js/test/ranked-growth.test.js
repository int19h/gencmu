import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngineCase } from "./shared.js";
import { hooks } from "../src/testing.js";

const definitions = "%rule text a ≻ b\n%rule a X Y\n%rule b X Y";

test("ranked groups grow with forest positions", () => {
  const before=hooks.slotAdmission;
  try {
    for (let length=1;length<=16;length*=2) {
      const runs=[];hooks.slotAdmission=(stats)=>runs.push(stats);
      const got=runEngineCase({grammar:"%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a ≻ b\n%rule a X Y\n%rule b X Y",tokens:Array.from({length:length*2},(_,i)=>({text:i%2?"y":"x",tags:[i%2?"Y":"X"]}))});
      assert.equal(got.json.stages[0].verdict,"unique");
      assert.equal(runs[0].groups,length);
      assert.equal(runs[0].candidateEdges,length*2);
      assert.equal(runs[0].retainedEdges,length);
    }
  } finally {hooks.slotAdmission=before;}
});

test("ordinary stage ranking follows slot filtering for every directive", () => {
  for (const lean of ["lazy","greedy","late-elision"]) {
    const got=runEngineCase({grammar:`%ambiguity-resolution ${lean}\n${definitions}`,tokens:[{text:"x",tags:["X"]},{text:"y",tags:["Y"]}]});
    assert.equal(got.json.stages[0].verdict,"unique");
    assert.equal(got.json.tree.children[0].rule,"a");
  }
});


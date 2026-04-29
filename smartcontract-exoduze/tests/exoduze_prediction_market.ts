import * as anchor from "@coral-xyz/anchor"
import { assert } from "chai"

describe("exoduze_prediction_market", () => {
  anchor.setProvider(anchor.AnchorProvider.env())

  it("loads the Anchor workspace", () => {
    const program = anchor.workspace.ExoduzePredictionMarket as anchor.Program
    assert.ok(program.programId)
  })
})


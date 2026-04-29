const anchor = require("@coral-xyz/anchor")

module.exports = async function deploy(_provider: typeof anchor.AnchorProvider) {
  anchor.setProvider(_provider)
}


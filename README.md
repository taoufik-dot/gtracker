# Growth Tracker

Live app: **https://taoufik-dot.github.io/gtracker/**

This branch is published from a build, not edited by hand. `index.html` is
generated — a manual change here is overwritten by the next deploy.

## Cancelling a licence — `revoked.json`

The app reads **`revoked.json`** (that file, not this README) at every launch.
To cancel a licence, add its code or the buyer name to the list there:

```json
{
  "revoked": [
    "IIGR3E",
    "Buyer 07"
  ]
}
```

Editing that one file on GitHub is the whole operation — no rebuild, no
redeploy. Removing a line restores that licence on the buyer's next launch.
Never delete the file itself.

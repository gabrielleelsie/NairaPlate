# NairaPlate

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bbbf4c9a-1779-4134-b130-41f2d8e91702).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## How a change goes live

1. Changes are saved on the `NAIRAPLATECALC` branch (Lovable saves there, and so do pull requests).
2. In GitHub, open Actions, choose "Release to main", and run it with `NAIRAPLATECALC` as the source branch.
3. That brings the branch into `main`. Cloudflare builds `main` and deploys it to nairaplate.com.
4. Database changes are separate: they are SQL scripts kept privately (not in this repository), run by the owner in the Supabase SQL editor before the code that needs them.

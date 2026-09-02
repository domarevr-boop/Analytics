# Общие UI-компоненты

- Читайте `docs/DESIGN_SYSTEM.md` и `docs/UI_COMPONENTS.md`.
- Компонент получает данные и callbacks от feature/page и не владеет бизнес-формулами.
- Если несколько полей редактируют одну запись, сохраняйте каждое поле как patch поверх последнего снимка хранилища; снимок текущего React-рендера может устареть между последовательными `blur`.
- Переиспользуйте общие date/select/segmented/KPI/table contracts; не создавайте page-local копию.
- Сохраняйте responsive layout, focus states, loading/empty/error states и пагинацию больших списков.
- Проверки: `npm run lint`, `npm run build`; визуально проверьте затронутый экран.

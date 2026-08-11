export default function CompetitorsPage() {
  return (
    <section className="analytics-page-shell competitors-page">
      <header className="analytics-page-header competitors-page-heading">
        <div>
          <span className="analytics-page-eyebrow">АНАЛИТИКА · КОНКУРЕНТЫ</span>
          <h1>Конкуренты</h1>
          <p>Сравнение товаров и продавцов будет настроено после согласования структуры импортируемых данных.</p>
        </div>
      </header>

      <article className="analytics-empty-card competitors-empty-card">
        <span>ИСТОЧНИК ДАННЫХ НЕ ПОДКЛЮЧЁН</span>
        <h2>Страница готова к следующему этапу</h2>
        <p>После разбора файла импорта здесь появятся только подтверждённые показатели, фильтры и аналитические блоки.</p>
      </article>
    </section>
  );
}

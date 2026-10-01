function Field({ label, value }) {
  return <div className="inspector-field"><dt>{label}</dt><dd title={String(value)}>{String(value)}</dd></div>;
}

function InspectorLive({ items }) {
  const fields = [
    ['Name', item => item.name], ['Tag', item => item.tag], ['ID', item => item.id || 'None'],
    ['Classes', item => item.classes?.join(' ') || 'None'],
    ['Size', item => `${Math.round(item.rect?.width || 0)} × ${Math.round(item.rect?.height || 0)} px`],
    ['Position', item => `${item.live?.pageX || 0}, ${item.live?.pageY || 0} px`],
    ['Text', item => item.live?.text || 'None'], ['Text color', item => item.live?.color || 'Mixed'],
    ['Background', item => item.live?.background || 'Mixed'], ['Font', item => item.live?.fontFamily || 'Mixed'],
    ['Font size', item => item.live?.fontSize || 'Mixed'], ['Weight', item => item.live?.fontWeight || 'Mixed'],
  ];
  return <div className="inspector-section"><h3>Live</h3><dl className="inspector-fields">{fields.map(([label, read]) => {
    const values = items.map(read);
    return <Field key={label} label={label} value={values.every(value => value === values[0]) ? values[0] : 'Mixed'} />;
  })}</dl></div>;
}

export default function InspectorPanel({ activeScreen, activeSelection, removed, detailState, detailsRetry }) {
  return (
    <section className="panel inspector-panel">
      <header className="panel-header"><h2>Inspector</h2></header>
        {!activeScreen || !activeSelection.length ? <><div className="panel-empty">{removed ? 'This element no longer exists' : 'Select an element to inspect'}</div>
          {detailState.error && <div className="inspector-section"><h3>Details</h3><div className="region-error compact" role="alert"><span>{detailState.error}</span><button type="button" onClick={detailsRetry}>Retry</button></div></div>}
        </>
          : activeSelection.length > 1 ? <><div className="selection-summary">{activeSelection.length} elements</div><InspectorLive items={activeSelection} /></>
            : <><InspectorLive items={activeSelection} /><div className="inspector-section"><h3>Details</h3>
                {detailState.error ? <div className="region-error compact" role="alert"><span>{detailState.error}</span><button type="button" onClick={detailsRetry}>Retry</button></div>
                  : !activeSelection[0].dataKey ? <div className="panel-empty compact">No details</div>
                  : detailState.loading ? <div className="panel-empty compact">Loading details...</div>
                    : !detailState.data ? <div className="panel-empty compact">No details for this element</div>
                      : <dl className="inspector-fields">{Object.entries(detailState.data).map(([key, value]) => <Field key={key} label={key} value={value} />)}</dl>}
              </div></>}
    </section>
  );
}
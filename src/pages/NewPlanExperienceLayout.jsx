import { NewPlanFooter, NewPlanHero, NewPlanStepNav } from './NewPlanShell.jsx';
import { NewPlanConfigCards } from './NewPlanConfigCards.jsx';
import { NewPlanSelectionCards } from './NewPlanSelectionCards.jsx';
import { NewPlanPreviewSidebar } from './NewPlanPreviewSidebar.jsx';

const PLAN_STEPS = [
  { id: 1, title: '选标的' },
  { id: 2, title: '选模板' },
  { id: 3, title: '调参数' },
  { id: 4, title: '预览确认' }
];

export function NewPlanExperienceLayout(props) {
  const {
    activeStrategy,
    benchmarkCodeLabel,
    benchmarkCurrency,
    benchmarkFund,
    benchmarkNameLabel,
    computed,
    customDrawdown,
    derivedMa120,
    derivedMa200,
    derivedStageHigh,
    extraQuote,
    filteredMarketEntries,
    formatCurrency,
    formatFundPrice,
    formatMarketCode,
    formatMarketLabel,
    formatPercent,
    frequencyOptions,
    goToPlanStep,
    handleCreatePlan,
    isBasePriceDirtyRef,
    isEditing,
    isNameDirtyRef,
    isRiskPriceDirtyRef,
    isSaving,
    links,
    marketEntries,
    marketError,
    maxLayerWeight,
    maxUnlockedStep,
    onBack,
    planChangeSummary,
    planStep,
    planValidation,
    screeningAnswers,
    screeningResult,
    selectedAnchorNameLabel,
    selectedAssetType,
    selectedAssetTypeLabel,
    selectedFund,
    selectedFundCurrency,
    selectedFundLabel,
    selectedFrequencyLabel,
    selectedInstrumentCurrency,
    selectedStrategy,
    selectedStrategyParams,
    setCustomDrawdown,
    setScreeningAnswers,
    setState,
    setSymbolSearch,
    state,
    symbolSearch
  } = props;

  return (
    <>
      <NewPlanHero
        links={links}
        onBack={onBack}
        isEditing={isEditing}
        selectedFundCode={selectedFund?.code || state.symbol}
        benchmarkCodeLabel={benchmarkCodeLabel}
        activeStrategyLabel={activeStrategy.label}
        formatMarketCode={formatMarketCode}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <NewPlanStepNav planSteps={PLAN_STEPS} planStep={planStep} maxUnlockedStep={maxUnlockedStep} goToPlanStep={goToPlanStep} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
          <div className="min-w-0 space-y-6">
            <NewPlanSelectionCards
              planStep={planStep}
              marketError={marketError}
              selectedAssetTypeLabel={selectedAssetTypeLabel}
              symbolSearch={symbolSearch}
              setSymbolSearch={setSymbolSearch}
              marketEntries={marketEntries}
              filteredMarketEntries={filteredMarketEntries}
              state={state}
              setState={setState}
              selectedFund={selectedFund}
              selectedFundLabel={selectedFundLabel}
              selectedFundCurrency={selectedFundCurrency}
              benchmarkNameLabel={benchmarkNameLabel}
              benchmarkFund={benchmarkFund}
              benchmarkCurrency={benchmarkCurrency}
              extraQuote={extraQuote}
              selectedStrategy={selectedStrategy}
              activeStrategyLabel={activeStrategy.label}
              selectedStrategyParams={selectedStrategyParams}
              frequencyOptions={frequencyOptions}
              selectedAssetType={selectedAssetType}
              screeningAnswers={screeningAnswers}
              setScreeningAnswers={setScreeningAnswers}
              screeningResult={screeningResult}
              derivedStageHigh={derivedStageHigh}
              derivedMa120={derivedMa120}
              derivedMa200={derivedMa200}
              isBasePriceDirtyRef={isBasePriceDirtyRef}
              isRiskPriceDirtyRef={isRiskPriceDirtyRef}
              formatFundPrice={formatFundPrice}
              formatPercent={formatPercent}
              formatMarketLabel={formatMarketLabel}
            />
            <NewPlanConfigCards
              planStep={planStep}
              selectedStrategy={selectedStrategy}
              activeStrategyLabel={activeStrategy.label}
              computed={computed}
              selectedFund={selectedFund}
              selectedFundLabel={selectedFundLabel}
              selectedFundCurrency={selectedFundCurrency}
              benchmarkNameLabel={benchmarkNameLabel}
              benchmarkFund={benchmarkFund}
              benchmarkCurrency={benchmarkCurrency}
              extraQuote={extraQuote}
              state={state}
              setState={setState}
              selectedAssetTypeLabel={selectedAssetTypeLabel}
              selectedStrategyParams={selectedStrategyParams}
              selectedFrequencyLabel={selectedFrequencyLabel}
              frequencyOptions={frequencyOptions}
              selectedInstrumentCurrency={selectedInstrumentCurrency}
              customDrawdown={customDrawdown}
              setCustomDrawdown={setCustomDrawdown}
              isBasePriceDirtyRef={isBasePriceDirtyRef}
              isRiskPriceDirtyRef={isRiskPriceDirtyRef}
              derivedStageHigh={derivedStageHigh}
              derivedMa120={derivedMa120}
              derivedMa200={derivedMa200}
              formatFundPrice={formatFundPrice}
              formatPercent={formatPercent}
              formatCurrency={formatCurrency}
              isEditing={isEditing}
              isNameDirtyRef={isNameDirtyRef}
              planChangeSummary={planChangeSummary}
              planValidation={planValidation}
            />
          </div>

          <NewPlanPreviewSidebar
            planStep={planStep}
            computed={computed}
            maxLayerWeight={maxLayerWeight}
            selectedStrategy={selectedStrategy}
            selectedInstrumentCurrency={selectedInstrumentCurrency}
            selectedAnchorNameLabel={selectedAnchorNameLabel}
            formatFundPrice={formatFundPrice}
            formatPercent={formatPercent}
            formatCurrency={formatCurrency}
          />
        </div>
      </div>

      <NewPlanFooter
        links={links}
        planStep={planStep}
        isSaving={isSaving}
        activeStrategy={activeStrategy}
        computed={computed}
        goToPlanStep={goToPlanStep}
        handleCreatePlan={handleCreatePlan}
        onBack={onBack}
        isEditing={isEditing}
        formatCurrency={formatCurrency}
      />
    </>
  );
}

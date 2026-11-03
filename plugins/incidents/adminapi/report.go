package adminapi

import (
	"fmt"
	"net/http"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

func (a *API) createReport(r *http.Request, actor string) (int, any, error) {
	var input record.NewReport
	if err := decode(r, &input); err != nil {
		return 0, nil, err
	}
	report, err := a.service.CreateReport(r.Context(), actor, input)
	return http.StatusCreated, report, err
}

func (a *API) listReports(r *http.Request, _ string) (int, any, error) {
	limit, offset, err := window(r)
	if err != nil {
		return 0, nil, err
	}
	query := r.URL.Query()
	filter := record.ReportFilter{Stage: record.Stage(query.Get("stage")), Limit: limit, Offset: offset}
	switch query.Get("published") {
	case "":
	case "true":
		filter.PublishedOnly = true
	default:
		return 0, nil, fmt.Errorf("%w: published can only be true", record.ErrInvalid)
	}
	reports, err := a.service.ListReports(r.Context(), filter)
	return http.StatusOK, map[string]any{"reports": reports}, err
}

func (a *API) getReport(r *http.Request, _ string) (int, any, error) {
	report, err := a.service.GetReport(r.Context(), r.PathValue("id"))
	return http.StatusOK, report, err
}

func (a *API) changeReport(r *http.Request, actor string) (int, any, error) {
	var change record.ReportChange
	if err := decode(r, &change); err != nil {
		return 0, nil, err
	}
	report, err := a.service.ChangeReport(r.Context(), actor, r.PathValue("id"), change)
	return http.StatusOK, report, err
}

func (a *API) addReportUpdate(r *http.Request, actor string) (int, any, error) {
	var update record.NewReportUpdate
	if err := decode(r, &update); err != nil {
		return 0, nil, err
	}
	report, err := a.service.AddReportUpdate(r.Context(), actor, r.PathValue("id"), update)
	return http.StatusCreated, report, err
}

func (a *API) setReportPublished(r *http.Request, actor string) (int, any, error) {
	var input struct {
		Published *bool `json:"published"`
	}
	if err := decode(r, &input); err != nil {
		return 0, nil, err
	}
	if input.Published == nil {
		return 0, nil, fmt.Errorf("%w: published is required", record.ErrInvalid)
	}
	report, err := a.service.SetReportPublished(r.Context(), actor, r.PathValue("id"), *input.Published)
	return http.StatusOK, report, err
}

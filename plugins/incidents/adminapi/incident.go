package adminapi

import (
	"net/http"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

func (a *API) createIncident(r *http.Request, actor string) (int, any, error) {
	var input record.NewIncident
	if err := decode(r, &input); err != nil {
		return 0, nil, err
	}
	incident, err := a.service.CreateIncident(r.Context(), actor, input)
	return http.StatusCreated, incident, err
}

func (a *API) listIncidents(r *http.Request, _ string) (int, any, error) {
	limit, offset, err := window(r)
	if err != nil {
		return 0, nil, err
	}
	filter := record.IncidentFilter{State: record.State(r.URL.Query().Get("state")), Limit: limit, Offset: offset}
	incidents, err := a.service.ListIncidents(r.Context(), filter)
	return http.StatusOK, map[string]any{"incidents": incidents}, err
}

func (a *API) getIncident(r *http.Request, _ string) (int, any, error) {
	incident, err := a.service.GetIncident(r.Context(), r.PathValue("id"))
	return http.StatusOK, incident, err
}

func (a *API) changeIncident(r *http.Request, actor string) (int, any, error) {
	var change record.IncidentChange
	if err := decode(r, &change); err != nil {
		return 0, nil, err
	}
	incident, err := a.service.ChangeIncident(r.Context(), actor, r.PathValue("id"), change)
	return http.StatusOK, incident, err
}

func (a *API) setIncidentState(r *http.Request, actor string) (int, any, error) {
	var input struct {
		State record.State `json:"state"`
	}
	if err := decode(r, &input); err != nil {
		return 0, nil, err
	}
	incident, err := a.service.SetIncidentState(r.Context(), actor, r.PathValue("id"), input.State)
	return http.StatusOK, incident, err
}

func (a *API) addIncidentNote(r *http.Request, actor string) (int, any, error) {
	var input struct {
		Note string `json:"note"`
	}
	if err := decode(r, &input); err != nil {
		return 0, nil, err
	}
	incident, err := a.service.AddIncidentNote(r.Context(), actor, r.PathValue("id"), input.Note)
	return http.StatusCreated, incident, err
}
